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
