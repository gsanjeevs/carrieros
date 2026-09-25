// lib/observability.ts
// Structured logging / error-tracking seam — Gate 0→1 (docs/production-gates.md).
//
// Every event logs as structured JSON (one line,
// greppable/parseable by whatever log aggregator sits in front of the
// deployment) instead of the ad hoc `console.error('[route] context:', err)`
// strings scattered across routes today.
//
// Usage: pass a stable `route` name and whatever identifying context is
// available (userId/orgId) — never a raw secret/token/full request body.

import * as Sentry from '@sentry/nextjs'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'

// Deliberately NOT lib/supabase/server.ts's createAdminClient() -- that
// module also exports the cookie-based server client and imports
// `next/headers` at module scope, which breaks any client component that
// pulls in logError() (e.g. components/passkey/PasskeySignInButton.tsx) with
// a "next/headers in the Pages Router" bundling error. Same
// URL/service-role-key construction ai_provider_config/admin_events use
// under the hood, just inlined so this file stays safely importable from
// both client and server code -- persistErrorLog() below still only ever
// runs server-side (`typeof window === 'undefined'` guard).
function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Same env var lib/sentry-options.ts already uses to tag Sentry events by
// environment -- reused here rather than a second, competing variable name.
// Falls back to 'development' (not NODE_ENV directly) so a log line always
// says something explicit rather than silently omitting the field when
// unset, which is exactly the gap this was added to close (2026-09-21).
const ENVIRONMENT = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development'

export interface LogContext {
  route: string
  /** Pass `request.headers.get('x-request-id')` (set by proxy.ts) to correlate a log line with a response and tracker event. */
  requestId?: string | null
  userId?: string
  orgId?: number
  [key: string]: unknown
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack }
  }
  // AuthAdminProvider errors (lib/auth-admin/types.ts's AuthAdminError) are a
  // plain `{ message, status }` object, not an Error instance -- without this
  // branch String(error) collapses to the useless "[object Object]" for
  // every logError() call downstream of an admin auth failure (invite,
  // impersonate, cron reminders, ...).
  if (error && typeof error === 'object' && 'message' in error) {
    const { message, ...rest } = error as { message: unknown; [key: string]: unknown }
    return { message: String(message), ...rest }
  }
  return { message: String(error) }
}

// Keys that must never reach app_error_log's `context` column (or a log line
// aggregator, for that matter) -- anything secret/token/credential-shaped, or
// a raw request/response body a caller might carelessly pass as `extra`. This
// file has no prior redaction convention to reuse, so this list is
// deliberately narrow and name-based rather than trying to sniff values.
const SENSITIVE_KEY_PATTERN = /token|secret|password|passwd|api[_-]?key|authorization|credential|cookie|body/i

function redactContext(extra: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!extra) return null
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extra)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue
    // Only small, JSON-plain scalars/arrays -- never an object that could be
    // (or contain) a raw request/response payload.
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value
    }
  }
  return Object.keys(safe).length > 0 ? safe : null
}

// Best-effort mirror of this call into app_error_log, for the ShipmentX admin
// Debug/Error Log viewer (app/(admin)/admin/logs, migration 0038). Sentry
// (above) already does full exception tracking with stack traces -- this is
// deliberately NOT a second logging pipeline: short message only, small
// redacted context, and it must never throw or delay the response.
function persistErrorLog(context: LogContext, error: unknown, extra: Record<string, unknown> | undefined) {
  // logError() is called from client components too (Sentry.captureException
  // and the console.error above both work isomorphically) -- the DB mirror is
  // server-only: SUPABASE_SERVICE_ROLE_KEY is never available in the browser,
  // and must never be reached for even by accident.
  if (typeof window !== 'undefined') return
  try {
    const admin = createServiceRoleClient()
    const message = serializeError(error).message
    admin
      .from('app_error_log')
      .insert({
        route: context.route,
        message: typeof message === 'string' ? message.slice(0, 2000) : String(message),
        level: 'error',
        org_id: context.orgId ?? null,
        user_id: context.userId ?? null,
        request_id: context.requestId ?? null,
        context: redactContext(extra) as Json,
      })
      .then(({ error: insertError }) => {
        if (insertError) console.error('[observability] app_error_log insert failed:', insertError.message)
      })
  } catch (persistErr) {
    // Never let the debug-log mirror itself become the reason a request fails.
    console.error('[observability] app_error_log insert threw:', persistErr)
  }
}

export function logError(context: LogContext, error: unknown, extra?: Record<string, unknown>) {
  const payload = {
    level: 'error' as const,
    timestamp: new Date().toISOString(),
    environment: ENVIRONMENT,
    ...context,
    error: serializeError(error),
    ...extra,
  }
  console.error(JSON.stringify(payload))
  // No-op unless a DSN is configured (lib/sentry-options.ts), so this is safe
  // in every environment. Context goes in as tags/extra, never raw bodies.
  Sentry.captureException(error, {
    tags: { route: context.route, ...(context.requestId ? { request_id: context.requestId } : {}) },
    extra: { orgId: context.orgId, userId: context.userId, ...extra },
  })
  persistErrorLog(context, error, extra)
}

export function logEvent(context: LogContext, extra?: Record<string, unknown>) {
  const payload = {
    level: 'info' as const,
    timestamp: new Date().toISOString(),
    environment: ENVIRONMENT,
    ...context,
    ...extra,
  }
  console.log(JSON.stringify(payload))
}
