// tests/offline-queue.test.ts
// The write side of offline mode. A driver's action queued without signal must
// survive, replay through the API in order, never apply twice, and distinguish
// "server refused" (drop) from "couldn't reach the server" (keep). Covers all
// three command kinds: load status advances, DVIR submissions (inspection +
// best-effort attachments), and POD photo uploads -- including the
// photo-lives-on-local-storage-until-replay-time design (lib/local-photo-store.ts
// is mocked here as an in-memory map; see tests/local-photo-store shape below).
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface PostCall {
  url: string;
  params: { path?: { id: number }; header?: Record<string, string> };
  body: Record<string, unknown>;
}
type PostResponse = { data?: unknown; error?: unknown; response: { ok: boolean; status: number } };
type Handler = (call: PostCall) => Promise<PostResponse>;

const mockCalls: PostCall[] = [];
let mockHandlers: Partial<Record<string, Handler>> = {};

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    http: {
      POST: (url: string, init: { params: PostCall['params']; body: Record<string, unknown> }) => {
        const call: PostCall = { url, params: init.params, body: init.body };
        mockCalls.push(call);
        const handler = mockHandlers[url];
        if (!handler) return Promise.reject(new Error(`offline-queue.test.ts: no mock handler for POST ${url}`));
        return handler(call);
      },
    },
  },
}));

// In-memory stand-in for lib/local-photo-store.ts (AsyncStorage-adjacent, but for
// bytes): savePhotoLocally isn't exercised here since tests enqueue commands
// directly with a chosen localUri already "saved" into this map -- that's the
// queue's contract with the store, independent of how a screen populates it.
const mockPhotoStore = new Map<string, string>();
const mockDeleted: string[] = [];
jest.mock('@/lib/local-photo-store', () => ({
  savePhotoLocally: jest.fn(),
  readPhotoLocally: jest.fn(async (uri: string) => (mockPhotoStore.has(uri) ? mockPhotoStore.get(uri)! : null)),
  deletePhotoLocally: jest.fn((uri: string) => {
    mockPhotoStore.delete(uri);
    mockDeleted.push(uri);
  }),
}));

import { enqueueDvirSubmit, enqueueMilestone, enqueuePodUpload, flushQueue, getQueueLength } from '@/lib/offline-queue';

const respond = (status: number, data?: unknown): Handler => async () => ({
  data: status >= 200 && status < 300 ? (data ?? {}) : undefined,
  // lib/pod-upload.ts and lib/dvir-attachments.ts call response.text() when logging a
  // non-ok response, same as the real fetch Response openapi-fetch hands back.
  response: { ok: status >= 200 && status < 300, status, text: async () => 'mock error body' },
});
const networkError: Handler = () => Promise.reject(new TypeError('Network request failed'));

function defaultHandlers(): Partial<Record<string, Handler>> {
  return {
    '/api/v1/loads/{id}/milestones': respond(200),
    '/api/v1/loads/{id}/dvir-inspections': respond(200, { id: 900, defects: [] }),
    '/api/v1/dvir-inspections/{id}/attachment-uploads': respond(200, {
      upload_url: 'http://storage/put',
      storage_path: 'org/dvir/900/attach.bin',
      content_type: 'image/png',
    }),
    '/api/v1/dvir-inspections/{id}/attachments': respond(200, { ok: true }),
    '/api/v1/loads/{id}/document-uploads': respond(200, {
      upload_url: 'http://storage/put',
      storage_path: 'org/pod/8/photo.jpg',
      content_type: 'image/jpeg',
    }),
    '/api/v1/loads/{id}/documents': respond(200, { id: 1, type: 'pod', storage_path: 'org/pod/8/photo.jpg' }),
  };
}

const milestonePayload = (over: Partial<Parameters<typeof enqueueMilestone>[0]> = {}) => ({
  loadId: 1,
  expectedStatus: 'dispatched',
  newStatus: 'picked_up',
  idempotencyKey: 'key-aaaaaaaa',
  occurredAt: '2026-07-23T00:00:00.000Z',
  ...over,
});

const dvirPayload = (over: Partial<Parameters<typeof enqueueDvirSubmit>[0]> = {}) => ({
  loadId: 5,
  idempotencyKey: 'dvir-key-aaaa',
  type: 'pre_trip' as const,
  odometer: 1000,
  defects: [] as { area: 'brakes'; description: string; severity: 'minor' | 'major' }[],
  attachments: [] as Parameters<typeof enqueueDvirSubmit>[0]['attachments'],
  ...over,
});

const podPayload = (over: Partial<Parameters<typeof enqueuePodUpload>[0]> = {}) => ({
  loadId: 8,
  idempotencyKey: 'pod-key-aaaa',
  localUri: 'file:///offline-queue-photos/pod.jpg',
  contentType: 'image/jpeg' as const,
  ...over,
});

describe('offline-queue (command queue over the shared API)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockCalls.length = 0;
    mockPhotoStore.clear();
    mockDeleted.length = 0;
    mockHandlers = defaultHandlers();
    (globalThis as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('load.milestone', () => {
    it('starts empty and counts queued commands', async () => {
      expect(await getQueueLength()).toBe(0);
      await enqueueMilestone(milestonePayload(), '2026-07-23T00:00:00.000Z');
      expect(await getQueueLength()).toBe(1);
    });

    it('replays through the API with the original idempotency key and timestamp, then clears', async () => {
      await enqueueMilestone(milestonePayload({ loadId: 42, idempotencyKey: 'key-42-xxxx' }), '2026-07-23T00:00:01.000Z');
      const result = await flushQueue();
      expect(result).toEqual({ synced: 1, rejected: 0, remaining: 0 });

      const call = mockCalls.find((c) => c.url === '/api/v1/loads/{id}/milestones');
      expect(call?.params.path).toEqual({ id: 42 });
      expect(call?.params.header?.['Idempotency-Key']).toBe('key-42-xxxx');
      expect(call?.body).toEqual({ expected_status: 'dispatched', new_status: 'picked_up', occurred_at: '2026-07-23T00:00:00.000Z' });
    });

    it('replays in the order queued', async () => {
      await enqueueMilestone(milestonePayload({ newStatus: 'picked_up', idempotencyKey: 'key-1-aaaa' }), '2026-07-23T00:00:01.000Z');
      await enqueueMilestone(
        milestonePayload({ expectedStatus: 'picked_up', newStatus: 'in_transit', idempotencyKey: 'key-2-bbbb' }),
        '2026-07-23T00:00:02.000Z'
      );
      await flushQueue();
      expect(mockCalls.map((c) => c.body.new_status)).toEqual(['picked_up', 'in_transit']);
    });

    it('keeps a command when the server cannot be reached, and stops so later ones are not refused as conflicts', async () => {
      await enqueueMilestone(milestonePayload({ idempotencyKey: 'key-1-aaaa' }), '2026-07-23T00:00:01.000Z');
      await enqueueMilestone(milestonePayload({ newStatus: 'in_transit', idempotencyKey: 'key-2-bbbb' }), '2026-07-23T00:00:02.000Z');

      mockHandlers['/api/v1/loads/{id}/milestones'] = networkError;
      expect(await flushQueue()).toEqual({ synced: 0, rejected: 0, remaining: 2 });
      expect(mockCalls).toHaveLength(1); // stopped at the first failure

      mockHandlers['/api/v1/loads/{id}/milestones'] = respond(200);
      expect(await flushQueue()).toEqual({ synced: 2, rejected: 0, remaining: 0 });
    });

    it('keeps a command on a 5xx (server trouble is not a refusal)', async () => {
      await enqueueMilestone(milestonePayload(), '2026-07-23T00:00:01.000Z');
      mockHandlers['/api/v1/loads/{id}/milestones'] = respond(503);
      expect(await flushQueue()).toEqual({ synced: 0, rejected: 0, remaining: 1 });
    });

    it.each([409, 404, 403, 400])('drops and counts a command the server refused with %s', async (status) => {
      await enqueueMilestone(milestonePayload(), '2026-07-23T00:00:01.000Z');
      mockHandlers['/api/v1/loads/{id}/milestones'] = respond(status);
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
      const call = mockCalls.find((c) => c.url === '/api/v1/loads/{id}/milestones');
      expect(call?.params.path).toEqual({ id: 7 });
      expect(call?.body).toMatchObject({ expected_status: null, new_status: 'delivered', occurred_at: '2026-07-01T00:00:00.000Z' });
      expect(call?.params.header?.['Idempotency-Key']).toBe('legacy-old-1');
    });
  });

  describe('dvir.submit', () => {
    it('files the inspection, uploads attachments from their local photo files, then syncs and deletes the local files', async () => {
      mockPhotoStore.set('file:///offline-queue-photos/sig.png', 'AAAA');
      mockPhotoStore.set('file:///offline-queue-photos/brakes.jpg', 'BBBB');
      mockHandlers['/api/v1/loads/{id}/dvir-inspections'] = respond(200, { id: 77, defects: [{ id: 1, area: 'brakes' }] });

      await enqueueDvirSubmit(
        dvirPayload({
          loadId: 5,
          idempotencyKey: 'dvir-key-1',
          defects: [{ area: 'brakes', description: 'worn pad', severity: 'major' }],
          attachments: [
            { kind: 'signature', localUri: 'file:///offline-queue-photos/sig.png', contentType: 'image/png' },
            { kind: 'defect_photo', area: 'brakes', localUri: 'file:///offline-queue-photos/brakes.jpg', contentType: 'image/jpeg' },
          ],
        }),
        '2026-07-23T00:00:00.000Z'
      );

      expect(await flushQueue()).toEqual({ synced: 1, rejected: 0, remaining: 0 });

      const inspectionCall = mockCalls.find((c) => c.url === '/api/v1/loads/{id}/dvir-inspections');
      expect(inspectionCall?.params.path).toEqual({ id: 5 });
      expect(inspectionCall?.params.header?.['Idempotency-Key']).toBe('dvir-key-1');
      expect(inspectionCall?.body).toEqual({
        type: 'pre_trip',
        odometer: 1000,
        defects: [{ area: 'brakes', description: 'worn pad', severity: 'major' }],
      });

      const slotCalls = mockCalls.filter((c) => c.url === '/api/v1/dvir-inspections/{id}/attachment-uploads');
      expect(slotCalls).toHaveLength(2);
      expect(slotCalls.every((c) => c.params.path?.id === 77)).toBe(true);

      const finalizeCalls = mockCalls.filter((c) => c.url === '/api/v1/dvir-inspections/{id}/attachments');
      expect(finalizeCalls).toHaveLength(2);

      expect(mockDeleted.sort()).toEqual(['file:///offline-queue-photos/brakes.jpg', 'file:///offline-queue-photos/sig.png']);
    });

    it('keeps the command when the inspection call cannot reach the server', async () => {
      await enqueueDvirSubmit(dvirPayload(), '2026-07-23T00:00:01.000Z');
      mockHandlers['/api/v1/loads/{id}/dvir-inspections'] = networkError;
      expect(await flushQueue()).toEqual({ synced: 0, rejected: 0, remaining: 1 });
    });

    it('keeps the command on a 5xx from the inspection call', async () => {
      await enqueueDvirSubmit(dvirPayload(), '2026-07-23T00:00:01.000Z');
      mockHandlers['/api/v1/loads/{id}/dvir-inspections'] = respond(503);
      expect(await flushQueue()).toEqual({ synced: 0, rejected: 0, remaining: 1 });
    });

    it.each([409, 404, 403, 400])('drops and counts a command the server refused with %s', async (status) => {
      await enqueueDvirSubmit(dvirPayload(), '2026-07-23T00:00:01.000Z');
      mockHandlers['/api/v1/loads/{id}/dvir-inspections'] = respond(status);
      expect(await flushQueue()).toEqual({ synced: 0, rejected: 1, remaining: 0 });
    });

    it('does not undo or re-queue an already-filed inspection when an attachment upload is refused, and does NOT delete the local photo it could not upload', async () => {
      mockPhotoStore.set('file:///offline-queue-photos/sig.png', 'AAAA');
      mockHandlers['/api/v1/loads/{id}/dvir-inspections'] = respond(200, { id: 9, defects: [] });
      mockHandlers['/api/v1/dvir-inspections/{id}/attachment-uploads'] = respond(403);

      await enqueueDvirSubmit(
        dvirPayload({ attachments: [{ kind: 'signature', localUri: 'file:///offline-queue-photos/sig.png', contentType: 'image/png' }] }),
        '2026-07-23T00:00:01.000Z'
      );

      expect(await flushQueue()).toEqual({ synced: 1, rejected: 0, remaining: 0 });
      // The inspection itself synced (it's the compliance record), but its attachment
      // upload was refused -- there is no automatic retry for a single attachment, so
      // the local file must survive. Deleting it here would permanently destroy the
      // only remaining copy of the signature/defect photo for no functional benefit.
      expect(mockDeleted).not.toContain('file:///offline-queue-photos/sig.png');
      expect(mockPhotoStore.has('file:///offline-queue-photos/sig.png')).toBe(true);
    });

    it('skips (never crashes on) an attachment whose local photo file is missing at replay', async () => {
      mockHandlers['/api/v1/loads/{id}/dvir-inspections'] = respond(200, { id: 9, defects: [] });

      await enqueueDvirSubmit(
        dvirPayload({ attachments: [{ kind: 'signature', localUri: 'file:///offline-queue-photos/missing.png', contentType: 'image/png' }] }),
        '2026-07-23T00:00:01.000Z'
      );

      expect(await flushQueue()).toEqual({ synced: 1, rejected: 0, remaining: 0 });
      expect(mockCalls.some((c) => c.url === '/api/v1/dvir-inspections/{id}/attachment-uploads')).toBe(false);
    });
  });

  describe('pod.upload', () => {
    it('requests a fresh signed URL, PUTs the bytes, finalizes, then syncs and deletes the local file', async () => {
      mockPhotoStore.set('file:///offline-queue-photos/pod.jpg', 'ZZZZ');
      await enqueuePodUpload(podPayload({ loadId: 8, idempotencyKey: 'pod-key-1' }), '2026-07-23T00:00:00.000Z');

      expect(await flushQueue()).toEqual({ synced: 1, rejected: 0, remaining: 0 });

      const slotCall = mockCalls.find((c) => c.url === '/api/v1/loads/{id}/document-uploads');
      expect(slotCall?.params.path).toEqual({ id: 8 });
      expect(slotCall?.body).toMatchObject({ type: 'pod', content_type: 'image/jpeg' });

      expect(globalThis.fetch).toHaveBeenCalledWith('http://storage/put', expect.objectContaining({ method: 'PUT' }));

      const finalizeCall = mockCalls.find((c) => c.url === '/api/v1/loads/{id}/documents');
      expect(finalizeCall?.body).toEqual({ type: 'pod', storage_path: 'org/pod/8/photo.jpg' });
      // The finalize idempotency key is freshly minted at replay time (a signed URL/storage_path is
      // never stable across attempts), not the command's own queuing key.
      expect(finalizeCall?.params.header?.['Idempotency-Key']).toBeTruthy();

      expect(mockDeleted).toEqual(['file:///offline-queue-photos/pod.jpg']);
    });

    it('keeps the command when the server cannot be reached', async () => {
      mockPhotoStore.set('file:///offline-queue-photos/pod.jpg', 'ZZZZ');
      await enqueuePodUpload(podPayload(), '2026-07-23T00:00:01.000Z');
      mockHandlers['/api/v1/loads/{id}/document-uploads'] = networkError;
      expect(await flushQueue()).toEqual({ synced: 0, rejected: 0, remaining: 1 });
    });

    it('retries (does not reject) when the storage PUT itself fails', async () => {
      mockPhotoStore.set('file:///offline-queue-photos/pod.jpg', 'ZZZZ');
      await enqueuePodUpload(podPayload(), '2026-07-23T00:00:01.000Z');
      (globalThis as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => 'storage hiccup' }));
      expect(await flushQueue()).toEqual({ synced: 0, rejected: 0, remaining: 1 });
    });

    it.each([409, 404, 403, 400])('drops and counts a command the server refused with %s at the slot step', async (status) => {
      mockPhotoStore.set('file:///offline-queue-photos/pod.jpg', 'ZZZZ');
      await enqueuePodUpload(podPayload(), '2026-07-23T00:00:01.000Z');
      mockHandlers['/api/v1/loads/{id}/document-uploads'] = respond(status);
      expect(await flushQueue()).toEqual({ synced: 0, rejected: 1, remaining: 0 });
    });

    it.each([409, 404, 403, 400])('drops and counts a command the server refused with %s at the finalize step', async (status) => {
      mockPhotoStore.set('file:///offline-queue-photos/pod.jpg', 'ZZZZ');
      await enqueuePodUpload(podPayload(), '2026-07-23T00:00:01.000Z');
      mockHandlers['/api/v1/loads/{id}/documents'] = respond(status);
      expect(await flushQueue()).toEqual({ synced: 0, rejected: 1, remaining: 0 });
    });

    it('rejects gracefully (never throws) when the local photo file is missing at replay', async () => {
      await enqueuePodUpload(podPayload({ localUri: 'file:///offline-queue-photos/missing.jpg' }), '2026-07-23T00:00:01.000Z');
      expect(await flushQueue()).toEqual({ synced: 0, rejected: 1, remaining: 0 });
      expect(mockCalls.some((c) => c.url === '/api/v1/loads/{id}/document-uploads')).toBe(false);
    });
  });

  describe('mixed queue', () => {
    it('replays different command kinds in the order they were queued', async () => {
      mockPhotoStore.set('file:///offline-queue-photos/pod.jpg', 'ZZZZ');

      await enqueueMilestone(milestonePayload({ idempotencyKey: 'm-1' }), '2026-07-23T00:00:01.000Z');
      await enqueueDvirSubmit(dvirPayload({ idempotencyKey: 'd-1' }), '2026-07-23T00:00:02.000Z');
      await enqueuePodUpload(podPayload({ idempotencyKey: 'p-1' }), '2026-07-23T00:00:03.000Z');

      expect(await flushQueue()).toEqual({ synced: 3, rejected: 0, remaining: 0 });
      expect(mockCalls.map((c) => c.url)).toEqual([
        '/api/v1/loads/{id}/milestones',
        '/api/v1/loads/{id}/dvir-inspections',
        '/api/v1/loads/{id}/document-uploads',
        '/api/v1/loads/{id}/documents',
      ]);
    });
  });
});
