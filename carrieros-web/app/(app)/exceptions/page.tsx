// app/(app)/exceptions/page.tsx
// Dedicated exceptions inbox — the full-detail counterpart to the
// lightweight banners on the Owner/Solo/Dispatcher dashboards. Tier-gated
// per BRD FR-18.1: Starter sees only the top 3 (most urgent first) plus an
// upgrade banner; Growth+ sees the full list grouped by tier.
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { hasFeature } from '@/lib/entitlements'
import { getExceptions, TIER_ORDER, TIER_COLOR, type ExceptionItem, type ExceptionTier } from '@/lib/exceptions'
import { Card } from '@/components/ui'
import { getProfileForUser } from '@/lib/queries/profiles'

const EXCEPTION_ROLES = ['owner', 'solo', 'dispatcher']

export default async function ExceptionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) redirect('/onboarding')
  if (!EXCEPTION_ROLES.includes(profile.role)) redirect('/dashboard')

  const t = await getTranslations('exceptions')

  const [entitled, items] = await Promise.all([
    hasFeature(supabase, 'full_exceptions_inbox'),
    getExceptions(supabase, profile.org_id),
  ])

  const total = items.length
  const visible = entitled ? items : items.slice(0, 3)

  const tierLabel: Record<ExceptionTier, string> = {
    today: t('tierToday'),
    this_week: t('tierThisWeek'),
    upcoming: t('tierUpcoming'),
  }

  const grouped = entitled
    ? TIER_ORDER.map((tier) => ({ tier, items: visible.filter((i) => i.tier === tier) })).filter((g) => g.items.length > 0)
    : [{ tier: 'top' as const, items: visible }]

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
      <p className="text-text-sec text-sm mt-1">{t('subtitle')}</p>

      {total === 0 ? (
        <Card className="mt-8">
          <div className="flex flex-col items-center justify-center text-center px-6 py-14">
            <span className="material-symbols-outlined text-success text-4xl">check_circle</span>
            <p className="text-text-pri font-medium mt-3">{t('allClear')}</p>
            <p className="text-text-sec text-sm mt-1">{t('allClearSub')}</p>
          </div>
        </Card>
      ) : (
        <div className="mt-8 space-y-8">
          {grouped.map((group) => (
            <div key={group.tier}>
              {entitled && (
                <h2 className="text-text-sec text-sm font-semibold uppercase tracking-wide mb-3">
                  {tierLabel[group.tier as ExceptionTier]}
                </h2>
              )}
              <Card className="divide-y divide-divider-ui">
                {group.items.map((item, idx) => (
                  <ExceptionRow key={`${item.entity_type}-${item.entity_id}-${item.exception_type}-${idx}`} item={item} t={t} />
                ))}
              </Card>
            </div>
          ))}

          {!entitled && (
            <Link
              href="/billing"
              className="block bg-brand-orange/10 border border-brand-orange/30 rounded-xl px-5 py-4 text-brand-orange text-sm font-medium hover:bg-brand-orange/15 transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
            >
              {t('upgradeBanner', { shown: visible.length, total })}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

// Literal strings (not template-built) so Tailwind v4's content scanner picks
// them up at build time — same pattern/reasoning as Sidebar.tsx's
// ROLE_BADGE_CLASSES.
const TIER_BADGE_CLASSES: Record<string, { bg: string; text: string }> = {
  danger:  { bg: 'bg-danger/15',  text: 'text-danger' },
  warning: { bg: 'bg-warning/15', text: 'text-warning' },
  info:    { bg: 'bg-info/15',    text: 'text-info' },
}

function ExceptionRow({ item, t }: { item: ExceptionItem; t: Awaited<ReturnType<typeof getTranslations>> }) {
  const color = TIER_BADGE_CLASSES[TIER_COLOR[item.tier]] ?? TIER_BADGE_CLASSES.info
  const ctaLabel = ctaLabelFor(item.exception_type, t)

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${color.bg}`}>
          <span className={`material-symbols-outlined text-[18px] ${color.text}`}>{item.icon}</span>
        </div>
        <div className="min-w-0">
          <p className="text-text-pri text-sm font-medium">{item.title}</p>
          <p className="text-text-sec text-xs mt-0.5 truncate">{item.detail}</p>
        </div>
      </div>
      {item.href && ctaLabel && (
        <Link
          href={item.href}
          className="flex-shrink-0 text-brand-orange text-xs font-medium hover:underline rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  )
}

function ctaLabelFor(exceptionType: string, t: Awaited<ReturnType<typeof getTranslations>>): string | null {
  switch (exceptionType) {
    case 'invoice_overdue': return t('ctaInvoice')
    case 'pod_missing': return t('ctaLoad')
    case 'cdl_expiring':
    case 'med_cert_expiring': return t('ctaDrivers')
    case 'maintenance_due': return t('ctaMaintenance')
    default: return null
  }
}
