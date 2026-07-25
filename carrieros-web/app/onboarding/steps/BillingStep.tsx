'use client'
// app/onboarding/steps/BillingStep.tsx
// Reuses the exact demo-mode "Add Card (Demo)" pattern from
// app/(app)/billing/AddPaymentMethodButton.tsx inside the onboarding shell —
// per decision T12, there is no card-number/CVV/expiry field here, ever,
// demo or not. Skippable: carrier_details.billing_status defaults to
// 'trialing' with a 90-day trial, so billing is genuinely optional at signup.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button, Callout, Card } from '@/components/ui'

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

      <Card className="px-4 py-4 flex items-center justify-between">
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
          <Button variant="primary" onClick={addPaymentMethod} disabled={loading} className="whitespace-nowrap text-sm">
            {loading ? tBilling('addingPaymentMethod') : tBilling('addPaymentMethod')}
          </Button>
        )}
        {card && <span className="material-symbols-outlined text-success">check_circle</span>}
      </Card>

      {error && <Callout tone="danger">{error}</Callout>}

      <div className="flex gap-3 mt-2">
        {!card && (
          <Button variant="secondary" onClick={() => onNext(false)} disabled={loading} className="flex-1 py-2.5 text-sm">
            {t('skipForNow')}
          </Button>
        )}
        <Button variant="primary" onClick={() => onNext(!!card)} className={`py-2.5 text-sm ${card ? 'w-full' : 'flex-2 flex-grow'}`}>
          {t('continue')}
        </Button>
      </div>
    </div>
  )
}
