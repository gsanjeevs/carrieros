import { describe, expect, it, jest, beforeEach } from '@jest/globals';

const mockCalls: string[] = [];
let mockSlot: () => Promise<{ data?: { upload_url: string; storage_path: string; content_type: string }; error?: unknown; response: { status: number; ok: boolean } }>;
let mockFinalize: () => Promise<{ response: { status: number; ok: boolean } }>;
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    http: {
      POST: (url: string) => {
        mockCalls.push(url);
        return url.endsWith('attachment-uploads') ? mockSlot() : mockFinalize();
      },
    },
  },
}));

import { uploadDvirAttachment } from '@/lib/dvir-attachments';

const slotOk = () => Promise.resolve({ data: { upload_url: 'http://storage/put', storage_path: '1/dvir/9/signature-x.png', content_type: 'image/png' }, response: { status: 200, ok: true } });
const bytes = new ArrayBuffer(4);

describe('uploadDvirAttachment', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    mockSlot = slotOk;
    mockFinalize = () => Promise.resolve({ response: { status: 200, ok: true } });
    (globalThis as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('runs the three steps in order and PUTs the bytes to the URL the server issued', async () => {
    expect(await uploadDvirAttachment(9, { kind: 'signature' }, 'image/png', bytes)).toBe(true);
    expect(mockCalls).toEqual(['/api/v1/dvir-inspections/{id}/attachment-uploads', '/api/v1/dvir-inspections/{id}/attachments']);
    const put = (globalThis.fetch as unknown as jest.Mock).mock.calls[0] as [string, { method: string; headers: Record<string, string> }];
    expect(put[0]).toBe('http://storage/put');
    expect(put[1]).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/png' } });
  });

  it('returns false (never throws) when the server refuses a slot, and does not attempt the upload', async () => {
    mockSlot = () => Promise.resolve({ error: { error_code: 'FORBIDDEN' }, response: { status: 403, ok: false } });
    expect(await uploadDvirAttachment(9, { kind: 'signature' }, 'image/png', bytes)).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns false when the storage PUT fails, without finalizing', async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: false, status: 415, text: async () => 'bad type' }));
    expect(await uploadDvirAttachment(9, { kind: 'defect_photo', area: 'brakes' }, 'image/jpeg', bytes)).toBe(false);
    expect(mockCalls).toEqual(['/api/v1/dvir-inspections/{id}/attachment-uploads']);
  });

  it('returns false when finalize is refused, and when the network throws', async () => {
    mockFinalize = () => Promise.resolve({ response: { status: 400, ok: false } });
    expect(await uploadDvirAttachment(9, { kind: 'signature' }, 'image/png', bytes)).toBe(false);
    mockSlot = () => Promise.reject(new TypeError('Network request failed'));
    await expect(uploadDvirAttachment(9, { kind: 'signature' }, 'image/png', bytes)).resolves.toBe(false);
  });
});
