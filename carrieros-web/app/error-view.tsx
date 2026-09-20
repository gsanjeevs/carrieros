'use client'

// Shared body for the route-level error boundaries (app/error.tsx and
// app/(app)/error.tsx). Reports the error to the tracker (no-op without a
// DSN) and offers a retry that re-renders the failed segment.
import { useEffect } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import * as Sentry from '@sentry/nextjs'
import { Button } from '@/components/ui'

export default function ErrorView({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('errorPage')

  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
      <h1 className="text-xl font-bold text-text-pri">{t('title')}</h1>
      <p className="text-sm text-text-sec">{t('body')}</p>
      {error.digest && (
        <p className="text-xs text-text-sec">
          {t('reference')}: <code>{error.digest}</code>
        </p>
      )}
      <div className="flex gap-3">
        <Button onClick={reset}>{t('retry')}</Button>
        <Link href="/dashboard">
          <Button variant="secondary" type="button">{t('home')}</Button>
        </Link>
      </div>
    </div>
  )
}
