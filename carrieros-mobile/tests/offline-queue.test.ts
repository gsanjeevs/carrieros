// tests/offline-queue.test.ts
// src/lib/offline-queue.ts is the write-side of offline mode (audit gap
// #13 cluster's last item) — a driver's status update queued while
// offline must survive and replay correctly once connectivity returns.
// Mocks '@/lib/supabase' (a thin fake .from().update().eq() chain) rather
// than hitting a real Postgres instance, since this is pure queue-ordering/
// persistence logic, not an RLS/business-logic concern already covered by
// carrieros-web's route tests.
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

const mockUpdateCalls: { table: string; patch: Record<string, unknown>; eqCalls: [string, unknown][] }[] = [];
let mockNextResult: { error: { message: string } | null } = { error: null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => {
        const eqCalls: [string, unknown][] = [];
        const builder = {
          eq: (key: string, value: unknown) => {
            eqCalls.push([key, value]);
            return builder;
          },
          then: (resolve: (v: { error: unknown }) => void) => {
            mockUpdateCalls.push({ table, patch, eqCalls });
            resolve(mockNextResult);
          },
        };
        return builder;
      },
    }),
  },
}));

import { enqueueUpdate, flushQueue, getQueueLength } from '@/lib/offline-queue';

describe('offline-queue', () => {
  beforeEach(async () => {
    mockNextResult = { error: null };
    // Drain any queue left over from a previous test before resetting the
    // call log — otherwise the drain's own replay calls would show up as
    // spurious entries in the next test's assertions.
    await flushQueue();
    mockUpdateCalls.length = 0;
  });

  it('starts empty', async () => {
    expect(await getQueueLength()).toBe(0);
  });

  it('enqueues an update and reports it in the queue length', async () => {
    await enqueueUpdate({ table: 'loads', match: { id: 1 }, patch: { status: 'delivered' } }, '2026-07-23T00:00:00.000Z');
    expect(await getQueueLength()).toBe(1);
  });

  it('flush replays queued updates against supabase and clears the queue on success', async () => {
    await enqueueUpdate({ table: 'loads', match: { id: 42 }, patch: { status: 'picked_up' } }, '2026-07-23T00:00:01.000Z');

    const result = await flushQueue();

    expect(result).toEqual({ synced: 1, remaining: 0 });
    expect(await getQueueLength()).toBe(0);
    expect(mockUpdateCalls).toHaveLength(1);
    expect(mockUpdateCalls[0].table).toBe('loads');
    expect(mockUpdateCalls[0].patch).toEqual({ status: 'picked_up' });
    expect(mockUpdateCalls[0].eqCalls).toEqual([['id', 42]]);
  });

  it('replays queued updates in the order they were queued', async () => {
    await enqueueUpdate({ table: 'loads', match: { id: 1 }, patch: { status: 'picked_up' } }, '2026-07-23T00:00:01.000Z');
    await enqueueUpdate({ table: 'loads', match: { id: 1 }, patch: { status: 'in_transit' } }, '2026-07-23T00:00:02.000Z');

    await flushQueue();

    expect(mockUpdateCalls.map((c) => c.patch)).toEqual([{ status: 'picked_up' }, { status: 'in_transit' }]);
  });

  it('leaves a failed update in the queue for the next flush rather than dropping it', async () => {
    await enqueueUpdate({ table: 'loads', match: { id: 7 }, patch: { status: 'delivered' } }, '2026-07-23T00:00:03.000Z');

    mockNextResult = { error: { message: 'network blip' } };
    const failedResult = await flushQueue();
    expect(failedResult).toEqual({ synced: 0, remaining: 1 });
    expect(await getQueueLength()).toBe(1);

    mockNextResult = { error: null };
    const retryResult = await flushQueue();
    expect(retryResult).toEqual({ synced: 1, remaining: 0 });
    expect(await getQueueLength()).toBe(0);
  });
});
