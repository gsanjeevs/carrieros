// instrumentation-client.ts -- browser-side Sentry init (runs before hydration).
import * as Sentry from '@sentry/nextjs'
import { sentryOptions } from '@/lib/sentry-options'

Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN))

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
