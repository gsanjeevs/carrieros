'use client'
// app/onboarding/steps/CompletionStep.tsx
// Checklist over what the prior steps just created, plus an "Add First Load"
// CTA. Per the confirmed decision, real inbound-load-email infrastructure is
// deferred (materially bigger scope than the rest of onboarding combined) —
// this shows a plain "coming soon" line rather than stubbing fake inbox
// behavior.

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Card, ChecklistItem } from '@/components/ui'

export default function CompletionStep({
  addedVehicle,
  addedCustomer,
  addedPaymentMethod,
}: {
  addedVehicle: boolean
  addedCustomer: boolean
  addedPaymentMethod: boolean
}) {
  const router = useRouter()
  const t = useTranslations('onboarding')

  const items = [
    { done: true, label: t('checklistCompany') },
    { done: addedVehicle, label: t('checklistVehicle') },
    { done: addedCustomer, label: t('checklistCustomer') },
    { done: addedPaymentMethod, label: t('checklistBilling') },
  ]

  return (
    <div className="space-y-5">
      <div className="text-center">
        <span className="material-symbols-outlined text-success text-4xl">check_circle</span>
        <h2 className="text-white font-semibold text-lg mt-2">{t('allSet')}</h2>
        <p className="text-slate-400 text-sm mt-1">{t('allSetSubtitle')}</p>
      </div>

      <div className="space-y-2">
        {items.map(item => (
          <ChecklistItem key={item.label} state={item.done ? 'done' : 'pending'} title={item.label} />
        ))}
      </div>

      <Card className="px-4 py-3">
        <p className="text-slate-400 text-xs">
          <span className="material-symbols-outlined text-[14px] align-middle mr-1">mail</span>
          {t('emailIntakeComingSoon')}
        </p>
      </Card>

      <div className="flex gap-3 mt-2">
        <Button variant="secondary" onClick={() => router.push('/dashboard')} className="flex-1 py-2.5 text-sm">
          {t('goToDashboard')}
        </Button>
        <Button variant="primary" onClick={() => router.push('/loads/new')} className="flex-2 flex-grow py-2.5 text-sm">
          {t('addFirstLoad')}
        </Button>
      </div>
    </div>
  )
}
