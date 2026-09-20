// src/lib/observability.ts
// Mobile counterpart of carrieros-web/lib/observability.ts: one structured
// place for errors to go, so a crash reporter can be attached later without
// touching call sites.
//
// No tracker SDK is installed yet. @sentry/react-native needs a native config
// plugin and a fresh dev-client/EAS build to verify, and that can't be
// validated from a JS-only session -- so this ships the seam plus a global
// handler, and `reportToTracker` below is the single place to wire the SDK
// once a DSN exists (set EXPO_PUBLIC_SENTRY_DSN, see .env.example).

export interface LogContext {
  /** Stable name of where this happened, e.g. 'load-detail' or 'root-boundary'. */
  where: string;
  userId?: string;
  orgId?: number;
  [key: string]: unknown;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack };
  }
  return { message: String(error) };
}

// Wire the tracker SDK here (Sentry.captureException(error, { extra: context })).
// Deliberately a no-op until then.
function reportToTracker(_error: unknown, _context: LogContext): void {}

export function logError(context: LogContext, error: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      ...context,
      error: serializeError(error),
    }),
  );
  reportToTracker(error, context);
}

let installed = false;

/**
 * Routes otherwise-unhandled JS exceptions and promise rejections through
 * logError, then defers to React Native's own handler (red box in dev, native
 * crash flow in release). Safe to call more than once.
 */
export function installGlobalErrorHandler(): void {
  if (installed) return;
  installed = true;

  const errorUtils = (globalThis as { ErrorUtils?: {
    getGlobalHandler: () => (e: unknown, isFatal?: boolean) => void;
    setGlobalHandler: (h: (e: unknown, isFatal?: boolean) => void) => void;
  } }).ErrorUtils;
  if (!errorUtils) return;

  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    logError({ where: 'global-handler', isFatal: Boolean(isFatal) }, error);
    previous(error, isFatal);
  });
}
