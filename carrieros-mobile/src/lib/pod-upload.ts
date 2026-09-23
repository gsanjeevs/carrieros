// src/lib/pod-upload.ts
// Upload a proof-of-delivery photo through the three-step signed-URL contract:
//   1. POST /loads/{id}/document-uploads -> server-chosen path + signed upload URL
//   2. PUT the JPEG bytes to that URL, straight to storage
//   3. POST /loads/{id}/documents         -> server verifies the object exists and records it
// Extracted out of components/pod-section.tsx so the offline queue's replay path
// (lib/offline-queue.ts) can reuse the exact same steps instead of re-implementing
// them -- the same reasoning lib/dvir-attachments.ts already follows for DVIR
// attachments, shared between the live screen and (now) queued replay.
//
// A fresh idempotency key is minted per call (matching lib/dvir-attachments.ts): the
// signed URL and storage_path are chosen fresh by the server on every call anyway (a
// signed URL is short-lived), so there is no stable "same submission" body to key off
// of the way there is for a status change or a DVIR inspection.
import { apiClient } from '@/lib/api-client';
import { newIdempotencyKey } from '@/lib/idempotency';
import { logError } from '@/lib/observability';

export type PodUploadResult =
  | { ok: true }
  | { ok: false; step: 'slot' | 'put' | 'finalize' | 'exception'; status?: number };

export async function uploadPodPhoto(loadId: number, contentType: 'image/jpeg', bytes: ArrayBuffer): Promise<PodUploadResult> {
  try {
    // 1. Ask for an upload slot. The server authorizes this actor for THIS load and chooses the path.
    const slot = await apiClient.http.POST('/api/v1/loads/{id}/document-uploads', {
      params: { path: { id: loadId } },
      body: { type: 'pod', content_type: contentType, size_bytes: bytes.byteLength },
    });
    if (!slot.data) {
      logError({ where: 'pod-upload', step: 'request-slot', status: slot.response.status, bytes: bytes.byteLength }, slot.error);
      return { ok: false, step: 'slot', status: slot.response.status };
    }

    // 2. Bytes go straight to storage.
    const put = await fetch(slot.data.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': slot.data.content_type },
      body: bytes,
    });
    if (!put.ok) {
      logError({ where: 'pod-upload', step: 'put-bytes', status: put.status, bytes: bytes.byteLength }, await put.text().catch(() => ''));
      return { ok: false, step: 'put', status: put.status };
    }

    // 3. Record it. The server verifies the object is really there; a retry with the same key applies once.
    const body = { type: 'pod' as const, storage_path: slot.data.storage_path };
    const { response } = await apiClient.http.POST('/api/v1/loads/{id}/documents', {
      params: { path: { id: loadId }, header: { 'Idempotency-Key': newIdempotencyKey() } },
      body,
    });
    if (!response.ok) {
      logError({ where: 'pod-upload', step: 'finalize', status: response.status }, await response.text().catch(() => ''));
      return { ok: false, step: 'finalize', status: response.status };
    }
    return { ok: true };
  } catch (e) {
    logError({ where: 'pod-upload', step: 'exception' }, e); // no signal, etc.
    return { ok: false, step: 'exception' };
  }
}
