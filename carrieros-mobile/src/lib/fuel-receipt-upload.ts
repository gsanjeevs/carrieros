// src/lib/fuel-receipt-upload.ts
// Upload a fuel-stop receipt photo (mockup-18's missing piece) through the same
// three-step signed-URL contract as lib/pod-upload.ts:
//   1. POST /loads/{id}/document-uploads (type 'fuel_receipt') -> server-chosen path + signed upload URL
//   2. PUT the JPEG bytes to that URL, straight to storage
//   3. POST /loads/{id}/fuel-stops/{fuel_stop_id}/receipt -> server verifies the object exists and attaches it
// Step 3 is a dedicated endpoint (not the generic finalize used by POD) because a
// fuel receipt is 1:1 with an already-created fuel_stops row, not one of a load's
// many listed documents -- see server/contract/schemas.ts's
// AttachFuelStopReceiptBodySchema comment on the web side.
import { apiClient } from '@/lib/api-client';
import { logError } from '@/lib/observability';

export type FuelReceiptUploadResult =
  | { ok: true }
  | { ok: false; step: 'slot' | 'put' | 'attach' | 'exception'; status?: number };

export async function uploadFuelStopReceipt(loadId: number, fuelStopId: number, contentType: 'image/jpeg', bytes: ArrayBuffer): Promise<FuelReceiptUploadResult> {
  try {
    // 1. Ask for an upload slot. The server authorizes this actor for THIS load and chooses the path.
    const slot = await apiClient.http.POST('/api/v1/loads/{id}/document-uploads', {
      params: { path: { id: loadId } },
      body: { type: 'fuel_receipt', content_type: contentType, size_bytes: bytes.byteLength },
    });
    if (!slot.data) {
      logError({ where: 'fuel-receipt-upload', step: 'request-slot', status: slot.response.status, bytes: bytes.byteLength }, slot.error);
      return { ok: false, step: 'slot', status: slot.response.status };
    }

    // 2. Bytes go straight to storage.
    const put = await fetch(slot.data.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': slot.data.content_type },
      body: bytes,
    });
    if (!put.ok) {
      logError({ where: 'fuel-receipt-upload', step: 'put-bytes', status: put.status, bytes: bytes.byteLength }, await put.text().catch(() => ''));
      return { ok: false, step: 'put', status: put.status };
    }

    // 3. Attach it to the fuel stop. The server re-verifies the object is really there.
    const { response } = await apiClient.http.POST('/api/v1/loads/{id}/fuel-stops/{fuel_stop_id}/receipt', {
      params: { path: { id: loadId, fuel_stop_id: fuelStopId } },
      body: { storage_path: slot.data.storage_path },
    });
    if (!response.ok) {
      logError({ where: 'fuel-receipt-upload', step: 'attach', status: response.status }, await response.text().catch(() => ''));
      return { ok: false, step: 'attach', status: response.status };
    }
    return { ok: true };
  } catch (e) {
    logError({ where: 'fuel-receipt-upload', step: 'exception' }, e); // no signal, etc.
    return { ok: false, step: 'exception' };
  }
}
