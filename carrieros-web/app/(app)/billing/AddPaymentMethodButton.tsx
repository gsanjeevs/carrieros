'use client'
// app/(app)/billing/AddPaymentMethodButton.tsx
//
// SAFETY BOUNDARY (do not weaken this, demo or not): this component must
// never grow a card-number, CVV, or expiry input field. "Adding a card" in
// this demo is this single button — clicking it calls
// POST /api/billing/add-payment-method, which simulates success server-side
// via lib/stripe.ts's createStripeCustomer() stub and stores a masked
// "visa / 4242" card, using Stripe's own published non-functional test
// number. There is nothing here for a user to type a real card into.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

export default function AddPaymentMethodButton({ hasPaymentMethod }: { hasPaymentMethod: boolean }) {
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

  async function addPaymentMethod() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/billing/add-payment-method', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('addFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        onClick={addPaymentMethod}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
      >
        <span className="material-symbols-outlined text-[18px]">credit_card</span>
        {loading ? t('addingPaymentMethod') : hasPaymentMethod ? t('replacePaymentMethod') : t('addPaymentMethod')}
      </button>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}
