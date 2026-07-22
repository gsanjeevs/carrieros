'use client'
// app/onboarding/steps/BillingStep.tsx
// Reuses the exact demo-mode "Add Card (Demo)" pattern from
// app/(app)/billing/AddPaymentMethodButton.tsx inside the onboarding shell —
// per decision T12, there is no card-number/CVV/expiry field here, ever,
// demo or not. Skippable: carrier_details.billing_status defaults to
// 'trialing' with a 90-day trial, so billing is genuinely optional at signup.

import { useState } from 'react'
import { useTranslations } from 'next-intl'

export default function BillingStep({ onNext }: { onNext: (added: boolean) => void }) {
  const t = useTranslations('onboarding')
  const tBilling = useTranslations('billing')
  const tErrors = useTranslations('errors')

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [card, setCard] = useState<{ brand: string; last4: string } | null>(null)

  async function addPaymentMethod() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/billing/add-payment-method', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))
      setCard({ brand: json.card_brand, last4: json.card_last4 })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tBilling('addFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-white font-semibold text-lg mb-1">{t('stepBillingTitle')}</h2>
      <p className="text-slate-400 text-sm mb-4">{t('stepBillingSubtitle')}</p>

      <div className="rounded-lg bg-white/5 border border-white/10 px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-slate-400">credit_card</span>
          <div>
            <p className="text-white text-sm font-medium">
              {card ? tBilling('cardOnFile', { brand: card.brand, last4: card.last4 }) : t('noPaymentMethodYet')}
            </p>
            <p className="text-slate-500 text-xs mt-0.5">{t('trialNotice')}</p>
          </div>
        </div>
        {!card && (
          <button
            onClick={addPaymentMethod}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
          >
            {loading ? tBilling('addingPaymentMethod') : tBilling('addPaymentMethod')}
          </button>
        )}
        {card && <span className="material-symbols-outlined text-[#16a34a]">check_circle</span>}
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3 mt-2">
        {!card && (
          <button
            onClick={() => onNext(false)}
            disabled={loading}
            className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white font-medium rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
          >
            {t('skipForNow')}
          </button>
        )}
        <button
          onClick={() => onNext(!!card)}
          className={`py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] text-white font-semibold rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50 ${card ? 'w-full' : 'flex-2 flex-grow'}`}
        >
          {t('continue')}
        </button>
      </div>
    </div>
  )
}
