// src/lib/profile-api.ts
// Writes to the caller's own profile through the shared API. Preferences are
// applied to local state immediately (appearance must switch on tap, not after a
// round trip), so a failed sync must not throw into the UI: it is logged and the
// value is simply re-sent the next time the user changes it or the profile loads.
import { apiClient } from '@/lib/api-client';
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
  const { error } = await apiClient.http.POST('/api/v1/me/avatar', { body: { base64, content_type: contentType } });
  if (error) throw new Error(`avatar upload rejected: ${JSON.stringify(error)}`);
}
