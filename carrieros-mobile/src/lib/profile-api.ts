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
