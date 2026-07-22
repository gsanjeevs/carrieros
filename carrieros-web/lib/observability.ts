// lib/observability.ts
// Structured logging / error-tracking seam — Gate 0→1 (docs/production-gates.md).
//
// No external error-tracking account (Sentry or equivalent) exists yet.
// Same demo-seam-first philosophy as lib/stripe.ts's createStripeCustomer():
// this is the ONE place a real integration gets wired in later, once a real
// account/DSN exists — every call site below stays unchanged when that
// happens. Until then, every event logs as structured JSON (one line,
// greppable/parseable by whatever log aggregator sits in front of the
// deployment) instead of the ad hoc `console.error('[route] context:', err)`
// strings scattered across routes today.
//
// Usage: pass a stable `route` name and whatever identifying context is
// available (userId/orgId) — never a raw secret/token/full request body.

export interface LogContext {
  route: string
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
  // TODO(observability, Gate 1→2): once a real error-tracking service is
  // configured (e.g. an ERROR_TRACKING_DSN env var), report `payload` there
  // too. Until then this structured console line is the only sink.
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
