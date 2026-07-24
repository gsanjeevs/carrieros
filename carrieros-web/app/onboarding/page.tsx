'use client'
// app/onboarding/page.tsx
// Shown to any authenticated user who has no org_id yet.
//
// Six steps: company -> profile -> vehicle -> customer -> billing ->
// completion. org_id/carrier_details/profiles are created via POST
// /api/onboarding right after the 'profile' step submits (same call as
// before this rebuild) — every step after that already has org_id available,
// since org creation was always the last thing the original 2-step flow did
// before this rebuild extended it forward rather than reordering anything.

import { Suspense, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import AddLogoStep from './steps/AddLogoStep'
import AddVehicleStep from './steps/AddVehicleStep'
import AddCustomerStep from './steps/AddCustomerStep'
import BillingStep from './steps/BillingStep'
import CompletionStep from './steps/CompletionStep'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]
const CA_PROVINCES = ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT']

const STEPS = ['company', 'profile', 'logo', 'vehicle', 'customer', 'billing', 'completion'] as const
type Step = (typeof STEPS)[number]

const NET_TERMS_OPTIONS = [7, 15, 30, 45, 60] as const

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingFlow />
    </Suspense>
  )
}

function OnboardingFlow() {
  const t = useTranslations('onboarding')
  const tCommon = useTranslations('common')
  // Set only when arriving from /signup's plan picker (?tier=starter|growth);
  // admin-invited onboarding never has this param, so the fetch body's tier
  // stays undefined and api/onboarding/route.ts falls back to 'starter'.
  const tierParam = useSearchParams().get('tier')
  const [step, setStep] = useState<Step>('company')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [addedVehicle, setAddedVehicle] = useState(false)
  const [addedCustomer, setAddedCustomer] = useState(false)
  const [addedPaymentMethod, setAddedPaymentMethod] = useState(false)
  const [orgId, setOrgId] = useState<number | null>(null)

  const [form, setForm] = useState({
    // Company
    company_name: '',
    mc_number:    '',
    dot_number:   '',
    ein:          '',
    address:      '',
    country:      'US',
    state:        '',
    city:         '',
    zip:          '',
    default_net_terms_days: '30',
    // Profile
    first_name:   '',
    last_name:    '',
    role:         'owner' as 'owner' | 'solo',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const regions = form.country === 'CA' ? CA_PROVINCES : US_STATES

  async function submitOrg() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tierParam ? { ...form, tier: tierParam } : form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? t('setupFailed'))
      setOrgId(Number(json.org_id))
      setStep('logo')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-orange transition'
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5'

  const stepIndex = STEPS.indexOf(step)

  return (
    <div className="min-h-screen bg-navy flex items-center justify-center p-6">
      <div className="w-full max-w-lg">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-brand-orange text-2xl font-bold tracking-tight">Carrier</span>
            <span className="text-white text-2xl font-bold tracking-tight">OS</span>
          </div>
          <p className="text-slate-400 text-sm">{t('heading')}</p>
        </div>

        {/* Step dots — six steps is too many for the original per-step-label
            layout without crowding, so this is a slim progress bar (dot per
            step, connecting line, no per-dot label) rather than the original
            2-step design. */}
        <div className="flex items-center gap-2 mb-8 px-1">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center flex-1 last:flex-none">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 transition ${
                i < stepIndex ? 'bg-brand-orange' : i === stepIndex ? 'bg-brand-orange ring-4 ring-brand-orange/20' : 'bg-white/10'
              }`} />
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mx-1.5 transition ${i < stepIndex ? 'bg-brand-orange/40' : 'bg-white/10'}`} />
              )}
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-slate-500 -mt-6 mb-8">{t(`stepLabel_${step}` as never)}</p>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">

          {step === 'company' && (
            <div className="space-y-4">
              <h2 className="text-white font-semibold text-lg mb-5">{t('companyDetails')}</h2>

              <div>
                <label className={labelCls}>{t('companyName')} *</label>
                <input className={inputCls} placeholder="Acme Trucking LLC"
                  value={form.company_name} onChange={e => set('company_name', e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('mcNumber')}</label>
                  <input className={inputCls} placeholder="MC-123456"
                    value={form.mc_number} onChange={e => set('mc_number', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t('dotNumber')}</label>
                  <input className={inputCls} placeholder="1234567"
                    value={form.dot_number} onChange={e => set('dot_number', e.target.value)} />
                </div>
              </div>

              <div>
                <label className={labelCls}>{t('ein')}</label>
                <input className={inputCls} placeholder="12-3456789"
                  value={form.ein} onChange={e => set('ein', e.target.value)} />
              </div>

              <div>
                <label className={labelCls}>{t('streetAddress')}</label>
                <input className={inputCls} placeholder="1200 Freight Way"
                  value={form.address} onChange={e => set('address', e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('country')} *</label>
                  <select className={inputCls} value={form.country} onChange={e => { set('country', e.target.value); set('state', '') }}>
                    <option value="US">{t('countryUS')}</option>
                    <option value="CA">{t('countryCA')}</option>
                    <option value="MX">{t('countryMX')}</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t('stateProvince')} *</label>
                  <select className={inputCls} value={form.state} onChange={e => set('state', e.target.value)}>
                    <option value="">{tCommon('selectPlaceholder')}</option>
                    {regions.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('city')}</label>
                  <input className={inputCls} placeholder="Los Angeles"
                    value={form.city} onChange={e => set('city', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t('zip')}</label>
                  <input className={inputCls} placeholder="90001"
                    value={form.zip} onChange={e => set('zip', e.target.value)} />
                </div>
              </div>

              <div>
                <label className={labelCls}>{t('defaultNetTerms')}</label>
                <select className={inputCls} value={form.default_net_terms_days} onChange={e => set('default_net_terms_days', e.target.value)}>
                  {NET_TERMS_OPTIONS.map(days => (
                    <option key={days} value={days}>{t('netTermsOption', { days })}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => { if (form.company_name && form.state) setStep('profile') }}
                disabled={!form.company_name || !form.state}
                className="w-full mt-2 py-2.5 bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition text-sm"
              >
                {t('continue')}
              </button>
            </div>
          )}

          {step === 'profile' && (
            <div className="space-y-4">
              <h2 className="text-white font-semibold text-lg mb-5">{t('yourInfo')}</h2>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('firstName')} *</label>
                  <input className={inputCls} placeholder="John"
                    value={form.first_name} onChange={e => set('first_name', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t('lastName')} *</label>
                  <input className={inputCls} placeholder="Smith"
                    value={form.last_name} onChange={e => set('last_name', e.target.value)} />
                </div>
              </div>

              <div>
                <label className={labelCls}>{t('yourRole')}</label>
                <select className={inputCls} value={form.role} onChange={e => set('role', e.target.value)}>
                  <option value="owner">{t('roleOwner')}</option>
                  <option value="solo">{t('roleSolo')}</option>
                </select>
              </div>

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-3 mt-2">
                <button
                  onClick={() => setStep('company')}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white font-medium rounded-lg transition text-sm"
                >
                  {tCommon('back')}
                </button>
                <button
                  onClick={submitOrg}
                  disabled={loading || !form.first_name || !form.last_name}
                  className="flex-2 flex-grow py-2.5 bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition text-sm"
                >
                  {loading ? t('settingUp') : t('continue')}
                </button>
              </div>
            </div>
          )}

          {step === 'logo' && orgId != null && (
            <AddLogoStep orgId={orgId} onNext={() => setStep('vehicle')} />
          )}

          {step === 'vehicle' && (
            <AddVehicleStep onNext={(added) => { setAddedVehicle(added); setStep('customer') }} />
          )}

          {step === 'customer' && (
            <AddCustomerStep onNext={(added) => { setAddedCustomer(added); setStep('billing') }} />
          )}

          {step === 'billing' && (
            <BillingStep onNext={(added) => { setAddedPaymentMethod(added); setStep('completion') }} />
          )}

          {step === 'completion' && (
            <CompletionStep
              addedVehicle={addedVehicle}
              addedCustomer={addedCustomer}
              addedPaymentMethod={addedPaymentMethod}
            />
          )}
        </div>
      </div>
    </div>
  )
}
