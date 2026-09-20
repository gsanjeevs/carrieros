// instrumentation.ts -- Next.js calls register() once per server runtime.
import * as Sentry from '@sentry/nextjs'
import { sentryOptions } from '@/lib/sentry-options'

export async function register() {
  Sentry.init(sentryOptions(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN))
}

// Reports errors thrown in Server Components, route handlers and server
// actions that no try/catch handled.
export const onRequestError = Sentry.captureRequestError
