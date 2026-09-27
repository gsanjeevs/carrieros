// src/lib/profile-api.ts
// Writes to the caller's own profile through the shared API. Preferences are
// applied to local state immediately (appearance must switch on tap, not after a
// round trip), so a failed sync must not throw into the UI: it is logged and the
// value is simply re-sent the next time the user changes it or the profile loads.
import { apiClient } from '@/lib/api-client';
import { base64ToArrayBuffer } from '@/lib/base64';
import type { operations } from '@/lib/generated/api-types';
import { logError } from '@/lib/observability';

type PreferencesBody = NonNullable<
  operations['updateMyPreferences']['requestBody']
>['content']['application/json'];

export async function savePreferences(patch: PreferencesBody): Promise<void> {
  try {
    const { error } = await apiClient.http.PATCH('/api/v1/me/preferences', { body: patch });
    if (error) logError({ where: 'save-preferences' }, error);
  } catch (e) {
    logError({ where: 'save-preferences' }, e); // offline etc.
  }
}

export async function registerPushToken(token: string): Promise<void> {
  const { error } = await apiClient.http.PUT('/api/v1/me/push-token', { body: { token } });
  if (error) throw new Error(`push token registration rejected: ${JSON.stringify(error)}`);
}

export async function uploadAvatar(base64: string, contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'): Promise<void> {
  const bytes = base64ToArrayBuffer(base64);
  const slot = await apiClient.http.POST('/api/v1/me/avatar/uploads', {
    body: { content_type: contentType, size_bytes: bytes.byteLength },
  });
  if (!slot.data) throw new Error(`avatar upload slot rejected: ${JSON.stringify(slot.error)}`);
  const put = await fetch(slot.data.upload_url, { method: 'PUT', headers: { 'Content-Type': slot.data.content_type }, body: bytes });
  if (!put.ok) throw new Error(`avatar bytes rejected: ${put.status}`);
  const { error } = await apiClient.http.POST('/api/v1/me/avatar', { body: { storage_path: slot.data.storage_path } });
  if (error) throw new Error(`avatar finalize rejected: ${JSON.stringify(error)}`);
}
