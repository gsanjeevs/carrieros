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
  return { message: String(error) }
}

export function logError(context: LogContext, error: unknown, extra?: Record<string, unknown>) {
  const payload = {
    level: 'error' as const,
    timestamp: new Date().toISOString(),
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
    ...context,
    ...extra,
  }
  console.log(JSON.stringify(payload))
}
