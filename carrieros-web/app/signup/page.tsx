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
import { Button, Callout, Card, CardBody, Field, Input } from '@/components/ui'

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
    <div className="auth-shell min-h-screen bg-surface-page text-text-pri flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-brand-orange flex items-center justify-center">
              <span className="text-brand-on-primary font-bold text-sm">C</span>
            </div>
            <span className="text-text-pri font-semibold text-xl tracking-tight">CarrierOS</span>
          </div>
          <p className="text-text-sec text-sm">{t('tagline')}</p>
        </div>

        {step === 'plan' && (
          <div className="space-y-3">
            <h1 className="text-text-pri font-semibold text-lg mb-1 text-center">{t('choosePlan')}</h1>
            <p className="text-text-sec text-sm text-center mb-4">{t('trialNotice')}</p>

            {tiers.map(tier => (
              <Card
                key={tier.code}
                variant="selectable"
                selected={selectedTier === tier.code}
                onClick={() => setSelectedTier(tier.code)}
                className="w-full text-left !p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-text-pri font-bold">{tier.label}</span>
                  {tier.code === 'growth' && (
                    <span className="text-[10px] font-bold tracking-wide uppercase bg-brand-orange text-brand-on-primary rounded-full px-2 py-0.5">
                      {t('mostPopular')}
                    </span>
                  )}
                </div>
                <div className="text-2xl font-extrabold text-brand-orange mt-1">
                  ${tier.monthly_price}<span className="text-sm font-medium text-text-sec">{t('perMonth')}</span>
                </div>
                <div className="text-xs text-text-sec mt-1">
                  {t('trucksIncluded', { count: tier.included_trucks, additional: tier.price_per_additional_truck })}
                </div>
              </Card>
            ))}

            <Button
              variant="primary"
              size="lg"
              onClick={() => setStep('account')}
              disabled={!selectedTier}
              className="w-full mt-2 py-2.5"
            >
              {t('continueBtn')}
            </Button>

            <p className="mt-4 text-center text-xs text-text-mut">
              {t('alreadyHaveAccount')} <a href="/login" className="text-brand-orange hover:underline">{t('signIn')}</a>
            </p>
          </div>
        )}

        {step === 'account' && (
          <Card className="p-6">
            <CardBody className="p-0">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-text-pri font-semibold text-lg">{t('createAccount')}</h2>
              <Button variant="ghost" size="sm" onClick={() => setStep('plan')} className="text-xs">
                {t('changePlan')}
              </Button>
            </div>

            {errorCode && (
              <Callout tone="danger" className="mb-4 text-sm">
                {t(ERROR_KEYS[errorCode] ?? 'signupFailed')}
              </Callout>
            )}

            <form action={signUpWithEmail} className="space-y-4" onSubmit={() => setLoading(true)}>
              <input type="hidden" name="tier" value={selectedTier} />

              <Field label={t('yourName')} htmlFor="signup-name" required>
                <Input
                  id="signup-name"
                  name="name" type="text" required autoComplete="name" placeholder="Sam Johnson"
                  size="lg"
                />
              </Field>
              <Field label={t('email')} htmlFor="signup-email" required>
                <Input
                  id="signup-email"
                  name="email" type="email" required autoComplete="email" placeholder="you@yourcompany.com"
                  size="lg"
                />
              </Field>
              <Field label={t('password')} htmlFor="signup-password" required hint={t('passwordHint')}>
                <Input
                  id="signup-password"
                  name="password" type="password" required autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} placeholder="••••••••"
                  size="lg"
                />
              </Field>

              <Button
                variant="primary"
                size="lg"
                type="submit"
                disabled={loading}
                loading={loading}
                className="w-full py-2.5"
              >
                {loading ? t('creatingAccount') : t('createAccountBtn')}
              </Button>
            </form>

            <p className="mt-6 text-center text-xs text-text-mut">
              {t('alreadyHaveAccount')} <a href="/login" className="text-brand-orange hover:underline">{t('signIn')}</a>
            </p>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}
