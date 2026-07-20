'use client'
// app/onboarding/page.tsx
// Shown to any authenticated user who has no org_id yet.
// Creates organizations + carrier_details + profiles in one API call.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]
const CA_PROVINCES = ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT']

export default function OnboardingPage() {
  const router = useRouter()
  const t = useTranslations('onboarding')
  const tCommon = useTranslations('common')
  const [step, setStep] = useState<'company' | 'profile'>('company')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    // Company
    company_name: '',
    mc_number:    '',
    dot_number:   '',
    country:      'US',
    state:        '',
    city:         '',
    // Profile
    first_name:   '',
    last_name:    '',
    role:         'owner' as 'owner' | 'solo',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const regions = form.country === 'CA' ? CA_PROVINCES : US_STATES

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? t('setupFailed'))
      router.push('/dashboard')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
      setLoading(false)
    }
  }

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-[#f97316] transition'
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5'

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-[#f97316] text-2xl font-bold tracking-tight">Carrier</span>
            <span className="text-white text-2xl font-bold tracking-tight">OS</span>
          </div>
          <p className="text-slate-400 text-sm">{t('heading')}</p>
        </div>

        {/* Steps */}
        <div className="flex items-center gap-3 mb-8">
          {(['company', 'profile'] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition ${
                step === s ? 'bg-[#f97316] text-white' :
                (s === 'profile' && step === 'profile') || (s === 'company' && step !== 'company')
                  ? 'bg-[#f97316]/30 text-[#f97316]' : 'bg-white/10 text-slate-500'
              }`}>{i + 1}</div>
              <span className={`text-xs ${step === s ? 'text-white' : 'text-slate-500'}`}>
                {s === 'company' ? t('stepCompany') : t('stepProfile')}
              </span>
              {i === 0 && <div className="flex-1 h-px bg-white/10 mx-1" />}
            </div>
          ))}
        </div>

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

              <div>
                <label className={labelCls}>{t('city')}</label>
                <input className={inputCls} placeholder="Los Angeles"
                  value={form.city} onChange={e => set('city', e.target.value)} />
              </div>

              <button
                onClick={() => { if (form.company_name && form.state) setStep('profile') }}
                disabled={!form.company_name || !form.state}
                className="w-full mt-2 py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition text-sm"
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
                  className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white font-medium rounded-lg transition text-sm"
                >
                  {tCommon('back')}
                </button>
                <button
                  onClick={submit}
                  disabled={loading || !form.first_name || !form.last_name}
                  className="flex-2 flex-grow py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition text-sm"
                >
                  {loading ? t('settingUp') : t('launch')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
