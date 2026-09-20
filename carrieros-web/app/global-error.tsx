'use client'

/* eslint-disable no-restricted-syntax -- root layout is gone, so no i18n context exists in this file */

// Last-resort boundary: replaces the ROOT layout, so no providers, message
// catalogs or design-system CSS are available -- which is why this is plain,
// dependency-light markup with a single English string rather than
// next-intl. It only fires if the root layout itself throws.
import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem 1.5rem', textAlign: 'center' }}>
        <h1>Something went wrong</h1>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </body>
    </html>
  )
}
