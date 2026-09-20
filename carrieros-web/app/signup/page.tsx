'use client'
// app/signup/page.tsx
// Self-serve signup (mockup-09), Screens 1-2 (plan picker, account creation).
// Screens 3-7 of the mockup (company/truck/customer/billing/success) are NOT
// duplicated here -- they already exist as the shared /onboarding flow (used
// today for admin-invited users with no org_id yet), reused as-is with the
// chosen tier carried forward via ?tier=. No real card-number/CVV/expiry
// field anywhere in this flow, ever -- decisions.md T12 locks that out; the
// existing onboarding BillingStep's demo "Add Payment Method" button is what
// runs after this.

import { MIN_PASSWORD_LENGTH } from '@/lib/password-policy'
import { Suspense, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { signUpWithEmail } from './actions'

type TierRow = {
  code: string
  label: string
  monthly_price: number
  included_trucks: number
  price_per_additional_truck: number
}

const SELF_SERVE_TIERS = ['starter', 'growth'] as const

const ERROR_KEYS: Record<string, string> = {
  missing_fields: 'missingFields',
  weak_password: 'weakPassword',
  email_exists: 'emailExists',
  signup_failed: 'signupFailed',
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  )
}

function SignupForm() {
  const t = useTranslations('signup')
  const searchParams = useSearchParams()

  // Lazy initializers, not an effect — the redirect-back-with-error case only
  // needs to be read once, off the URL present at first render.
  const [step, setStep] = useState<'plan' | 'account'>(() => searchParams.get('error') ? 'account' : 'plan')
  const [tiers, setTiers] = useState<TierRow[]>([])
  const [selectedTier, setSelectedTier] = useState(() => searchParams.get('tier') === 'growth' ? 'growth' : 'starter')
  const [loading, setLoading] = useState(false)

  const errorCode = searchParams.get('error')

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('tiers')
      .select('code, label, monthly_price, included_trucks, price_per_additional_truck')
      .in('code', SELF_SERVE_TIERS as unknown as string[])
      .order('rank')
      .then(({ data }) => setTiers(data ?? []))
  }, [])

  return (
    <div className="min-h-screen bg-navy flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-brand-orange flex items-center justify-center">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            <span className="text-white font-semibold text-xl tracking-tight">CarrierOS</span>
          </div>
          <p className="text-slate-400 text-sm">{t('tagline')}</p>
        </div>

        {step === 'plan' && (
          <div className="space-y-3">
            <h1 className="text-white font-semibold text-lg mb-1 text-center">{t('choosePlan')}</h1>
            <p className="text-slate-400 text-sm text-center mb-4">{t('trialNotice')}</p>

            {tiers.map(tier => (
              <button
                key={tier.code}
                onClick={() => setSelectedTier(tier.code)}
                className={`w-full text-left rounded-xl border-2 p-4 transition ${
                  selectedTier === tier.code ? 'border-brand-orange bg-brand-orange/5' : 'border-white/10 bg-white/5 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-white font-bold">{tier.label}</span>
                  {tier.code === 'growth' && (
                    <span className="text-[10px] font-bold tracking-wide uppercase bg-brand-orange text-white rounded-full px-2 py-0.5">
                      {t('mostPopular')}
                    </span>
                  )}
                </div>
                <div className="text-2xl font-extrabold text-brand-orange mt-1">
                  ${tier.monthly_price}<span className="text-sm font-medium text-slate-400">{t('perMonth')}</span>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {t('trucksIncluded', { count: tier.included_trucks, additional: tier.price_per_additional_truck })}
                </div>
              </button>
            ))}

            <button
              onClick={() => setStep('account')}
              disabled={!selectedTier}
              className="w-full mt-2 py-2.5 bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-40 text-white font-semibold rounded-lg transition text-sm"
            >
              {t('continueBtn')}
            </button>

            <p className="mt-4 text-center text-xs text-slate-500">
              {t('alreadyHaveAccount')} <a href="/login" className="text-brand-orange hover:underline">{t('signIn')}</a>
            </p>
          </div>
        )}

        {step === 'account' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">{t('createAccount')}</h2>
              <button onClick={() => setStep('plan')} className="text-xs text-slate-400 hover:text-white">
                {t('changePlan')}
              </button>
            </div>

            {errorCode && (
              <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
                {t(ERROR_KEYS[errorCode] ?? 'signupFailed')}
              </div>
            )}

            <form action={signUpWithEmail} className="space-y-4" onSubmit={() => setLoading(true)}>
              <input type="hidden" name="tier" value={selectedTier} />

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">{t('yourName')}</label>
                <input
                  name="name" type="text" required autoComplete="name" placeholder="Sam Johnson"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent transition"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">{t('email')}</label>
                <input
                  name="email" type="email" required autoComplete="email" placeholder="you@yourcompany.com"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent transition"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">{t('password')}</label>
                <input
                  name="password" type="password" required autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} placeholder="••••••••"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent transition"
                />
                <p className="text-[11px] text-slate-500 mt-1">{t('passwordHint')}</p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-40 text-white font-semibold rounded-lg transition text-sm"
              >
                {loading ? t('creatingAccount') : t('createAccountBtn')}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-slate-500">
              {t('alreadyHaveAccount')} <a href="/login" className="text-brand-orange hover:underline">{t('signIn')}</a>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
