// lib/send-push.ts
// PRD P0: "driver receives push notification on assignment." Unlike the
// ACH/SMS stubs elsewhere in this codebase, Expo's push service itself is
// real, free, and requires no account/API key for a basic send — a POST
// to https://exp.host/--/api/v2/push/send with a valid Expo push token
// really does deliver. What's NOT configured in this project is an EAS
// project id (app.json's expo.extra.eas.projectId) — without one, the
// mobile client's getExpoPushTokenAsync() call fails, so no real device in
// this project ever registers a token yet. This function is the real,
// working other half; nothing here is a stub.
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export interface SendPushArgs {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
}

export interface SendPushResult {
  ok: boolean
  error?: string
}

export async function sendPushNotification({ to, title, body, data }: SendPushArgs): Promise<SendPushResult> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ to, title, body, data }),
    })
    const json = await res.json()
    if (!res.ok || json?.data?.status === 'error') {
      return { ok: false, error: json?.data?.message ?? `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown push error' }
  }
}
