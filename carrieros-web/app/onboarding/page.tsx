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
//
// Re-skinned onto components/ui/* (2026-07-25, mockup-06 re-skin Phase 5b) —
// this is the reference implementation the new Field/StepProgress/Callout
// primitives were built for. Scope note: this pass is debt cleanup + new
// primitives, not a full mockup-06 structural rebuild — there is still no
// welcome screen, no customer tags, no trial-callout/card-preview/security-
// badge block, no "Your Load Email" completion panel. Those are tracked as
// Phase 7 fidelity-audit findings, not folded in here.

import { Suspense, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Button, Callout, Field, Input, StepProgress } from '@/components/ui'
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

        <div className="mb-8">
          <StepProgress current={stepIndex + 1} total={STEPS.length} label={t(`stepLabel_${step}` as never)} />
        </div>

        <div className="bg-surface-card border border-border-ui rounded-card p-6">

          {step === 'company' && (
            <div className="space-y-4">
              <h2 className="text-white font-semibold text-lg mb-5">{t('companyDetails')}</h2>

              <Field label={t('companyName')} required>
                <Input size="lg" placeholder="Acme Trucking LLC"
                  value={form.company_name} onChange={e => set('company_name', e.target.value)} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('mcNumber')}>
                  <Input size="lg" placeholder="MC-123456"
                    value={form.mc_number} onChange={e => set('mc_number', e.target.value)} />
                </Field>
                <Field label={t('dotNumber')}>
                  <Input size="lg" placeholder="1234567"
                    value={form.dot_number} onChange={e => set('dot_number', e.target.value)} />
                </Field>
              </div>

              <Field label={t('ein')}>
                <Input size="lg" placeholder="12-3456789"
                  value={form.ein} onChange={e => set('ein', e.target.value)} />
              </Field>

              <Field label={t('streetAddress')}>
                <Input size="lg" placeholder="1200 Freight Way"
                  value={form.address} onChange={e => set('address', e.target.value)} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('country')} required>
                  <Input as="select" size="lg" value={form.country} onChange={e => { set('country', e.target.value); set('state', '') }}>
                    <option value="US">{t('countryUS')}</option>
                    <option value="CA">{t('countryCA')}</option>
                    <option value="MX">{t('countryMX')}</option>
                  </Input>
                </Field>
                <Field label={t('stateProvince')} required>
                  <Input as="select" size="lg" value={form.state} onChange={e => set('state', e.target.value)}>
                    <option value="">{tCommon('selectPlaceholder')}</option>
                    {regions.map(r => <option key={r} value={r}>{r}</option>)}
                  </Input>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('city')}>
                  <Input size="lg" placeholder="Los Angeles"
                    value={form.city} onChange={e => set('city', e.target.value)} />
                </Field>
                <Field label={t('zip')}>
                  <Input size="lg" placeholder="90001"
                    value={form.zip} onChange={e => set('zip', e.target.value)} />
                </Field>
              </div>

              <Field label={t('defaultNetTerms')}>
                <Input as="select" size="lg" value={form.default_net_terms_days} onChange={e => set('default_net_terms_days', e.target.value)}>
                  {NET_TERMS_OPTIONS.map(days => (
                    <option key={days} value={days}>{t('netTermsOption', { days })}</option>
                  ))}
                </Input>
              </Field>

              <Button
                variant="primary"
                onClick={() => { if (form.company_name && form.state) setStep('profile') }}
                disabled={!form.company_name || !form.state}
                className="w-full mt-2 py-2.5 text-sm"
              >
                {t('continue')}
              </Button>
            </div>
          )}

          {step === 'profile' && (
            <div className="space-y-4">
              <h2 className="text-white font-semibold text-lg mb-5">{t('yourInfo')}</h2>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('firstName')} required>
                  <Input size="lg" placeholder="John"
                    value={form.first_name} onChange={e => set('first_name', e.target.value)} />
                </Field>
                <Field label={t('lastName')} required>
                  <Input size="lg" placeholder="Smith"
                    value={form.last_name} onChange={e => set('last_name', e.target.value)} />
                </Field>
              </div>

              <Field label={t('yourRole')}>
                <Input as="select" size="lg" value={form.role} onChange={e => set('role', e.target.value)}>
                  <option value="owner">{t('roleOwner')}</option>
                  <option value="solo">{t('roleSolo')}</option>
                </Input>
              </Field>

              {error && <Callout tone="danger">{error}</Callout>}

              <div className="flex gap-3 mt-2">
                <Button
                  variant="secondary"
                  onClick={() => setStep('company')}
                  disabled={loading}
                  className="flex-1 py-2.5 text-sm"
                >
                  {tCommon('back')}
                </Button>
                <Button
                  variant="primary"
                  onClick={submitOrg}
                  disabled={loading || !form.first_name || !form.last_name}
                  loading={loading}
                  className="flex-2 flex-grow py-2.5 text-sm"
                >
                  {loading ? t('settingUp') : t('continue')}
                </Button>
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
