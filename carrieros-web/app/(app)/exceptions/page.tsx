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

const EXCEPTION_ROLES = ['owner', 'solo', 'dispatcher']

export default async function ExceptionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

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
      <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
      <p className="text-slate-400 text-sm mt-1">{t('subtitle')}</p>

      {total === 0 ? (
        <div className="mt-8 bg-white/5 border border-white/8 rounded-xl px-5 py-14 text-center shadow-card-dark">
          <span className="material-symbols-outlined text-success text-4xl">check_circle</span>
          <p className="text-white font-medium mt-3">{t('allClear')}</p>
          <p className="text-slate-500 text-sm mt-1">{t('allClearSub')}</p>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {grouped.map((group) => (
            <div key={group.tier}>
              {entitled && (
                <h2 className="text-slate-300 text-sm font-semibold uppercase tracking-wide mb-3">
                  {tierLabel[group.tier as ExceptionTier]}
                </h2>
              )}
              <div className="bg-white/5 border border-white/8 rounded-xl divide-y divide-white/5 shadow-card-dark overflow-hidden">
                {group.items.map((item, idx) => (
                  <ExceptionRow key={`${item.entity_type}-${item.entity_id}-${item.exception_type}-${idx}`} item={item} t={t} />
                ))}
              </div>
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
          <p className="text-white text-sm font-medium">{item.title}</p>
          <p className="text-slate-400 text-xs mt-0.5 truncate">{item.detail}</p>
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
