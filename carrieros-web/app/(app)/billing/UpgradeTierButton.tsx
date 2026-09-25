'use client'
// app/(app)/billing/UpgradeTierButton.tsx
//
// One button per tier card on /billing. DEMO MODE (2026-07-21, same seam as
// AddPaymentMethodButton.tsx): clicking this calls
// POST /api/billing/change-tier, which writes carrier_details.tier directly
// — there is no real Stripe subscription change here, no proration, no
// invoice. A real integration replaces this with a Stripe Checkout/portal
// redirect; this button is the UI seam that flow will attach to.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { apiClient } from '@/lib/api-client'

export default function UpgradeTierButton({
  tierCode,
  isCurrent,
  isDowngrade,
}: {
  tierCode: string
  isCurrent: boolean
  isDowngrade: boolean
}) {
  const router = useRouter()
  const t = useTranslations('billing')
  const tErrors = useTranslations('errors')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  async function changeTier() {
    setLoading(true)
    setError('')
    try {
      const { data, error: err } = await apiClient.http.POST('/api/v1/billing/change-tier', {
        body: { tier: tierCode },
      })
      if (err || !data) throw new Error(friendly((err as { error_code?: string } | undefined)?.error_code))
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('changeTierFailed'))
    } finally {
      setLoading(false)
    }
  }

  if (isCurrent) {
    return (
      <span className="block text-center text-xs font-semibold text-brand-orange py-2">
        {t('currentPlanBadge')}
      </span>
    )
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={changeTier}
        disabled={loading}
        className="w-full px-3 py-2 bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
      >
        {loading ? t('changingPlan') : isDowngrade ? t('downgrade') : t('upgrade')}
      </button>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}
