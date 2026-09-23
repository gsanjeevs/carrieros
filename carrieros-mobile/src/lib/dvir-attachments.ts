// src/lib/dvir-attachments.ts
// Attach a signature or defect photo to a filed DVIR, in the same three steps as load documents so the
// bytes go straight to storage instead of through the API:
//   1. ask the API for a server-chosen path + signed upload URL
//   2. PUT the bytes to it (an ArrayBuffer, not a Blob: see lib/base64.ts)
//   3. tell the API to verify the object is there and attach it
// Best-effort by design: the inspection (a safety record) is already saved, so a failed attachment
// returns false for the caller to warn about; it never throws and never undoes the inspection.
import { apiClient } from '@/lib/api-client';
import { keyForSubmission } from '@/lib/idempotency';
import { logError } from '@/lib/observability';

// Exported so lib/offline-queue.ts (queued dvir.submit commands) and src/app/dvir/[loadId].tsx
// share one definition instead of re-declaring the area union.
export type DvirArea = 'brakes' | 'lights' | 'tires' | 'steering' | 'horn' | 'mirrors' | 'coupling_devices' | 'emergency_equipment';

export async function uploadDvirAttachment(
  inspectionId: number,
  attachment: { kind: 'signature' } | { kind: 'defect_photo'; area: DvirArea },
  contentType: 'image/png' | 'image/jpeg',
  bytes: ArrayBuffer
): Promise<boolean> {
  const area = attachment.kind === 'defect_photo' ? attachment.area : null;
  try {
    const slot = await apiClient.http.POST('/api/v1/dvir-inspections/{id}/attachment-uploads', {
      params: { path: { id: inspectionId } },
      body: { kind: attachment.kind, area, content_type: contentType },
    });
    if (!slot.data) {
      logError({ where: 'dvir-attachment', step: 'request-slot', status: slot.response.status }, slot.error);
      return false;
    }

    const put = await fetch(slot.data.upload_url, { method: 'PUT', headers: { 'Content-Type': slot.data.content_type }, body: bytes });
    if (!put.ok) {
      logError({ where: 'dvir-attachment', step: 'put-bytes', status: put.status }, await put.text().catch(() => ''));
      return false;
    }

    const body = { kind: attachment.kind, area, storage_path: slot.data.storage_path };
    const ref = { current: null as { key: string; body: string } | null };
    const { response } = await apiClient.http.POST('/api/v1/dvir-inspections/{id}/attachments', {
      params: { path: { id: inspectionId }, header: { 'Idempotency-Key': keyForSubmission(ref, { inspectionId, ...body }) } },
      body,
    });
    if (!response.ok) {
      logError({ where: 'dvir-attachment', step: 'finalize', status: response.status }, await response.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    logError({ where: 'dvir-attachment', step: 'exception' }, e);
    return false;
  }
}
