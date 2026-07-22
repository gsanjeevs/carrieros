// app/(app)/billing/page.tsx
// Billing — subscription tier, trial countdown, and payment method status.
// Owner/solo only, same gate pattern as app/(app)/team/page.tsx: this is an
// administration surface, not one dispatchers or finance should reach.
//
// DEMO MODE: there is no Stripe account yet (decision P4/PR2, amended
// 2026-07-20 — a real card-on-file flow is planned but not built). Adding a
// payment method here is a single button that simulates success using
// Stripe's own published test card constant. See lib/stripe.ts for the seam
// a real integration will replace, and AddPaymentMethodButton.tsx for why
// there is deliberately no card-number input anywhere on this page.
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/format-datetime'
import AddPaymentMethodButton from './AddPaymentMethodButton'
import UpgradeTierButton from './UpgradeTierButton'

const TIER_PRICE: Record<string, string> = {
  starter: '$49/mo',
  growth: '$99/mo',
  pro: '$199/mo',
  enterprise: '$349/mo',
}

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role, date_format, time_format')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) redirect('/onboarding')
  if (!['owner', 'solo'].includes(profile.role)) redirect('/dashboard')

  const { data: details } = await supabase
    .from('carrier_details')
    .select('tier, billing_status, trial_ends_at, stripe_customer_id, card_brand, card_last4')
    .eq('org_id', profile.org_id)
    .single()

  const t = await getTranslations('billing')

  const tier = details?.tier ?? 'starter'
  const hasPaymentMethod = Boolean(details?.stripe_customer_id)

  // Fleet usage vs. this tier's included-truck allowance (2026-07-21 —
  // BR-9's "trucks included + per-additional-truck" model existed only as
  // unused columns on `tiers` until now; this is informational, not a hard
  // block, matching the metered-billing model the BRD actually describes).
  const { count: vehicleCount } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .eq('carrier_org_id', profile.org_id)
    .eq('is_active', true)

  const { data: allTiers } = await supabase
    .from('tiers')
    .select('code, label, rank, monthly_price, included_trucks, price_per_additional_truck')
    .order('rank')

  const currentTierRow = allTiers?.find((r) => r.code === tier)
  const includedTrucks = currentTierRow?.included_trucks ?? 0
  const overageCount = Math.max(0, (vehicleCount ?? 0) - includedTrucks)
  const overageFee = overageCount * Number(currentTierRow?.price_per_additional_truck ?? 0)
  const currentRank = currentTierRow?.rank ?? 1

  const trialDaysLeft = details?.trial_ends_at
    ? Math.max(
        0,
        Math.ceil((new Date(details.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      )
    : null

  const isTrialing = details?.billing_status === 'trialing'

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
        <p className="text-slate-400 text-sm mt-1">{t('subtitle')}</p>
      </div>

      {/* Demo mode banner — required, visible UI copy, not a code comment. */}
      <div className="mb-6 flex items-start gap-3 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3">
        <span className="material-symbols-outlined text-amber-400 text-[18px]">science</span>
        <p className="text-amber-300 text-sm font-medium">{t('demoModeBanner')}</p>
      </div>

      <div className="space-y-4">
        {/* Plan */}
        <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">{t('currentPlan')}</p>
          <div className="flex items-center justify-between">
            <span className="text-white text-lg font-semibold capitalize">{t(`tier_${tier}` as never)}</span>
            <span className="text-slate-400 text-sm">{TIER_PRICE[tier] ?? ''}</span>
          </div>
        </div>

        {/* Trial status */}
        {isTrialing && (
          <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">{t('trialStatus')}</p>
            {trialDaysLeft !== null ? (
              <>
                <p className="text-white text-lg font-semibold">
                  {trialDaysLeft > 0
                    ? t('trialDaysLeft', { count: trialDaysLeft })
                    : t('trialEnded')}
                </p>
                <p className="text-slate-400 text-sm mt-1">
                  {t('trialEndsOn', { date: formatDate(details?.trial_ends_at, profile) })}
                </p>
              </>
            ) : (
              <p className="text-slate-400 text-sm">{t('noTrialData')}</p>
            )}
          </div>
        )}

        {/* Payment method */}
        <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">{t('paymentMethod')}</p>
          <div className="flex items-center justify-between gap-4">
            <div>
              {hasPaymentMethod ? (
                <p className="text-white text-sm font-medium">
                  {t('cardOnFile', {
                    brand: (details?.card_brand ?? 'card').toUpperCase(),
                    last4: details?.card_last4 ?? '••••',
                  })}
                </p>
              ) : (
                <p className="text-slate-400 text-sm">{t('noPaymentMethod')}</p>
              )}
            </div>
            <AddPaymentMethodButton hasPaymentMethod={hasPaymentMethod} />
          </div>
        </div>

        {/* Fleet usage vs. included trucks (2026-07-21) */}
        <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">{t('fleetUsage')}</p>
          <p className="text-white text-sm">
            {t('trucksUsed', { count: vehicleCount ?? 0, included: includedTrucks })}
          </p>
          {overageCount > 0 && (
            <p className="text-amber-300 text-sm mt-1">
              {t('overageFee', { count: overageCount, fee: overageFee.toFixed(2) })}
            </p>
          )}
        </div>
      </div>

      {/* Tier comparison + upgrade/downgrade (2026-07-21) */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-white mb-3">{t('comparePlans')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {allTiers?.map((row) => (
            <div
              key={row.code}
              className={`rounded-xl border p-4 flex flex-col gap-2 ${
                row.code === tier
                  ? 'border-brand-orange bg-brand-orange/10'
                  : 'border-white/8 bg-white/5'
              }`}
            >
              <p className="text-white text-sm font-semibold">{t(`tier_${row.code}` as never)}</p>
              <p className="text-slate-400 text-xs">{TIER_PRICE[row.code] ?? ''}</p>
              <p className="text-slate-500 text-xs">
                {t('includedTrucks', { count: row.included_trucks })}
              </p>
              <UpgradeTierButton
                tierCode={row.code}
                isCurrent={row.code === tier}
                isDowngrade={row.rank < currentRank}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
