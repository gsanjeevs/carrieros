'use client'
// app/onboarding/steps/CompletionStep.tsx
// Checklist over what the prior steps just created, plus an "Add First Load"
// CTA. Per the confirmed decision, real inbound-load-email infrastructure is
// deferred (materially bigger scope than the rest of onboarding combined) —
// this shows a plain "coming soon" line rather than stubbing fake inbox
// behavior.

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

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
          <div key={item.label} className="flex items-center gap-2.5 rounded-lg bg-white/5 border border-white/10 px-4 py-2.5">
            <span className={`material-symbols-outlined text-[18px] ${item.done ? 'text-success' : 'text-slate-600'}`}>
              {item.done ? 'check_circle' : 'radio_button_unchecked'}
            </span>
            <span className={`text-sm ${item.done ? 'text-white' : 'text-slate-500'}`}>{item.label}</span>
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-white/5 border border-white/10 px-4 py-3">
        <p className="text-slate-400 text-xs">
          <span className="material-symbols-outlined text-[14px] align-middle mr-1">mail</span>
          {t('emailIntakeComingSoon')}
        </p>
      </div>

      <div className="flex gap-3 mt-2">
        <button
          onClick={() => router.push('/dashboard')}
          className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white font-medium rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          {t('goToDashboard')}
        </button>
        <button
          onClick={() => router.push('/loads/new')}
          className="flex-2 flex-grow py-2.5 bg-brand-orange hover:bg-brand-orange-hover text-white font-semibold rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          {t('addFirstLoad')}
        </button>
      </div>
    </div>
  )
}
