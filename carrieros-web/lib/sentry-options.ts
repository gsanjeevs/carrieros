// lib/sentry-options.ts
// Shared Sentry init options for the server, edge and browser runtimes.
//
// Inert by design: with no DSN configured, `enabled` is false and nothing is
// sent, so local dev, CI and any environment that hasn't been set up yet are
// unaffected. Set SENTRY_DSN (server/edge) and NEXT_PUBLIC_SENTRY_DSN
// (browser) per environment -- see .env.example and architecture/deployment.md.
//
// PII policy: sendDefaultPii stays false, so request bodies, cookies, headers
// and IPs are not attached. Add context deliberately via lib/observability.ts
// (route, userId, orgId) -- never raw tokens or bodies.
export function sentryOptions(dsn: string | undefined) {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    // Low by default: errors are always captured, traces are sampled.
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  }
}
