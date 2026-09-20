// tests/offline-queue.test.ts
// The write side of offline mode. A driver's action queued without signal must
// survive, replay through the API in order, never apply twice, and distinguish
// "server refused" (drop) from "couldn't reach the server" (keep).
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Call { path: { id: number }; key: string; body: Record<string, unknown> }
const mockCalls: Call[] = [];
let mockNext: () => Promise<{ response: { ok: boolean; status: number } }>;

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    http: {
      POST: (_url: string, init: { params: { path: { id: number }; header: Record<string, string> }; body: Record<string, unknown> }) => {
        mockCalls.push({ path: init.params.path, key: init.params.header['Idempotency-Key'], body: init.body });
        return mockNext();
      },
    },
  },
}));

import { enqueueMilestone, flushQueue, getQueueLength } from '@/lib/offline-queue';

const payload = (over: Partial<Parameters<typeof enqueueMilestone>[0]> = {}) => ({
  loadId: 1,
  expectedStatus: 'dispatched',
  newStatus: 'picked_up',
  idempotencyKey: 'key-aaaaaaaa',
  occurredAt: '2026-07-23T00:00:00.000Z',
  ...over,
});
const respond = (status: number) => () => Promise.resolve({ response: { ok: status >= 200 && status < 300, status } });

describe('offline-queue (command queue over the shared API)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockCalls.length = 0;
    mockNext = respond(200);
  });

  it('starts empty and counts queued commands', async () => {
    expect(await getQueueLength()).toBe(0);
    await enqueueMilestone(payload(), '2026-07-23T00:00:00.000Z');
    expect(await getQueueLength()).toBe(1);
  });

  it('replays through the API with the original idempotency key and timestamp, then clears', async () => {
    await enqueueMilestone(payload({ loadId: 42, idempotencyKey: 'key-42-xxxx' }), '2026-07-23T00:00:01.000Z');
    const result = await flushQueue();
    expect(result).toEqual({ synced: 1, rejected: 0, remaining: 0 });
    expect(mockCalls).toEqual([
      {
        path: { id: 42 },
        key: 'key-42-xxxx',
        body: { expected_status: 'dispatched', new_status: 'picked_up', occurred_at: '2026-07-23T00:00:00.000Z' },
      },
    ]);
  });

  it('replays in the order queued', async () => {
    await enqueueMilestone(payload({ newStatus: 'picked_up', idempotencyKey: 'key-1-aaaa' }), '2026-07-23T00:00:01.000Z');
    await enqueueMilestone(payload({ expectedStatus: 'picked_up', newStatus: 'in_transit', idempotencyKey: 'key-2-bbbb' }), '2026-07-23T00:00:02.000Z');
    await flushQueue();
    expect(mockCalls.map((c) => c.body.new_status)).toEqual(['picked_up', 'in_transit']);
  });

  it('keeps a command when the server cannot be reached, and stops so later ones are not refused as conflicts', async () => {
    await enqueueMilestone(payload({ idempotencyKey: 'key-1-aaaa' }), '2026-07-23T00:00:01.000Z');
    await enqueueMilestone(payload({ newStatus: 'in_transit', idempotencyKey: 'key-2-bbbb' }), '2026-07-23T00:00:02.000Z');

    mockNext = () => Promise.reject(new TypeError('Network request failed'));
    expect(await flushQueue()).toEqual({ synced: 0, rejected: 0, remaining: 2 });
    expect(mockCalls).toHaveLength(1); // stopped at the first failure

    mockNext = respond(200);
    expect(await flushQueue()).toEqual({ synced: 2, rejected: 0, remaining: 0 });
  });

  it('keeps a command on a 5xx (server trouble is not a refusal)', async () => {
    await enqueueMilestone(payload(), '2026-07-23T00:00:01.000Z');
    mockNext = respond(503);
    expect(await flushQueue()).toEqual({ synced: 0, rejected: 0, remaining: 1 });
  });

  it.each([409, 404, 403, 400])('drops and counts a command the server refused with %s', async (status) => {
    await enqueueMilestone(payload(), '2026-07-23T00:00:01.000Z');
    mockNext = respond(status);
    expect(await flushQueue()).toEqual({ synced: 0, rejected: 1, remaining: 0 });
  });

  it('migrates a v1 queue entry (raw table update) into a milestone command instead of dropping it', async () => {
    await AsyncStorage.setItem(
      'carrieros:offline-queue:v1',
      JSON.stringify([{ id: 'old-1', table: 'loads', match: { id: 7 }, patch: { status: 'delivered' }, queuedAt: '2026-07-01T00:00:00.000Z' }])
    );
    expect(await getQueueLength()).toBe(1);
    expect(await AsyncStorage.getItem('carrieros:offline-queue:v1')).toBeNull();

    await flushQueue();
    expect(mockCalls[0].path).toEqual({ id: 7 });
    expect(mockCalls[0].body).toMatchObject({ expected_status: null, new_status: 'delivered', occurred_at: '2026-07-01T00:00:00.000Z' });
    expect(mockCalls[0].key).toBe('legacy-old-1');
  });
});
