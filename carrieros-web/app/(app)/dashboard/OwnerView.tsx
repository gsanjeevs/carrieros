// app/(app)/dashboard/OwnerView.tsx
// The full-visibility dashboard: all 4 KPIs + Fleet Status + Driver
// Compliance breakdowns + Recent Loads. Used directly by Owner, and
// composed (with a "My Load Today" card prepended) by SoloView.
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { formatMoney } from '@/lib/format-money'
import ExceptionsBanner from './ExceptionsBanner'
import { STATUS_COLOR } from '@/lib/domain/load-status'

interface KpiCard {
  label: string
  value: string | number
  sub?: string
  color?: string
  icon: string
}

interface BreakdownStat {
  label: string
  value: number
  color: string
}

interface BreakdownCard {
  label: string
  icon: string
  color: string
  primary: { label: string; value: number }
  stats: BreakdownStat[]
}

// A driver is a compliance risk if either credential is missing or expiring
// within this window (including already-expired, i.e. a negative day count).
const COMPLIANCE_DUE_SOON_DAYS = 30

// Was: a local copy of loads/page.tsx's STATUS_COLOR. Now sourced from
// lib/domain/load-status.ts (docs/architecture-principles.md Rule A) —
// re-exported here since DispatcherView.tsx already imports it from this
// file; new call sites should import directly from lib/domain/load-status.
export { STATUS_COLOR }

export default async function OwnerView({ orgId, embedded = false }: { orgId: number | undefined; embedded?: boolean }) {
  const supabase = await createClient()
  const t = await getTranslations('dashboard')
  const tLoads = await getTranslations('loads')
  const locale = await getLocale()

  const STATUS_BADGE: Record<string, { label: string; color: string }> = Object.fromEntries(
    Object.entries(STATUS_COLOR).map(([key, color]) => [key, { label: tLoads(`status_${key}`), color }])
  )

  // Current-calendar-month bounds for Revenue MTD. Plain JS Date math is fine
  // here (server component, no user-facing date_format needed) — cf.
  // lib/format-datetime.ts's toDate() for the pattern this mirrors when a
  // DATE-only column is involved.
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  // Driver compliance is bucketed if either credential expiry is within this
  // many days of today (a negative diff, i.e. already expired, still counts
  // as due-soon rather than a separate "expired" bucket — see task notes).
  const dueSoonCutoff = new Date(now.getTime() + COMPLIANCE_DUE_SOON_DAYS * 24 * 60 * 60 * 1000)

  const [
    loadsRes,
    recentLoadsRes,
    revenueRes,
    outstandingRes,
    ratesRes,
    fleetStatusRes,
    complianceRes,
  ] = await Promise.all([
    orgId
      ? supabase.from('loads').select('id, status', { count: 'exact' }).eq('carrier_org_id', orgId)
      : Promise.resolve({ count: 0, data: [] }),
    orgId
      ? supabase
          .from('loads')
          .select('id, load_number, status, pickup_city, pickup_state, delivery_city, delivery_state, customer_name_raw')
          .eq('carrier_org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
    // Revenue MTD: invoices paid within the current calendar month.
    orgId
      ? supabase
          .from('invoices')
          .select('amount')
          .eq('carrier_org_id', orgId)
          .eq('status', 'paid')
          .gte('paid_at', startOfMonth.toISOString())
          .lt('paid_at', startOfNextMonth.toISOString())
      : Promise.resolve({ data: [] }),
    // Outstanding: invoiced but not yet paid.
    orgId
      ? supabase
          .from('invoices')
          .select('amount', { count: 'exact' })
          .eq('carrier_org_id', orgId)
          .in('status', ['sent', 'overdue'])
      : Promise.resolve({ data: [], count: 0 }),
    // Avg rate/load: exclude cancelled loads — a cancelled load's rate was
    // never actually earned, so including it would understate the average.
    orgId
      ? supabase
          .from('loads')
          .select('rate')
          .eq('carrier_org_id', orgId)
          .neq('status', 'cancelled')
          .not('rate', 'is', null)
      : Promise.resolve({ data: [] }),
    orgId
      ? supabase.from('vehicles').select('status').eq('carrier_org_id', orgId).eq('is_active', true)
      : Promise.resolve({ data: [] }),
    orgId
      ? supabase.from('drivers').select('cdl_expiry, med_cert_expiry').eq('carrier_org_id', orgId).eq('is_active', true)
      : Promise.resolve({ data: [] }),
  ])

  const recentLoads = recentLoadsRes.data ?? []

  const activeLoads = (loadsRes.data ?? []).filter(
    (l: { status: string | null }) =>
      l.status !== null && ['dispatched','picked_up','in_transit'].includes(l.status)
  ).length

  const revenueMtd = (revenueRes.data ?? []).reduce(
    (sum: number, inv: { amount: number | string | null }) => sum + Number(inv.amount ?? 0), 0
  )

  const outstandingInvoices = (outstandingRes.data ?? []) as { amount: number | string | null }[]
  const outstandingAmount = outstandingInvoices.reduce(
    (sum: number, inv: { amount: number | string | null }) => sum + Number(inv.amount ?? 0), 0
  )
  const outstandingCount = outstandingRes.count ?? outstandingInvoices.length

  const rateRows = (ratesRes.data ?? []) as { rate: number | string | null }[]
  const avgRate = rateRows.length
    ? rateRows.reduce((sum: number, l: { rate: number | string | null }) => sum + Number(l.rate ?? 0), 0) / rateRows.length
    : 0

  const fleetRows = (fleetStatusRes.data ?? []) as { status: string | null }[]
  const fleetActive = fleetRows.filter((v) => v.status === 'active').length
  const fleetIdle = fleetRows.filter((v) => v.status === 'idle').length
  const fleetInShop = fleetRows.filter((v) => v.status === 'in_shop').length

  const complianceRows = (complianceRes.data ?? []) as { cdl_expiry: string | null; med_cert_expiry: string | null }[]
  let complianceClear = 0, complianceDueSoon = 0, complianceIncomplete = 0
  for (const d of complianceRows) {
    if (!d.cdl_expiry || !d.med_cert_expiry) {
      complianceIncomplete++
      continue
    }
    const cdl = new Date(d.cdl_expiry)
    const med = new Date(d.med_cert_expiry)
    if (cdl <= dueSoonCutoff || med <= dueSoonCutoff) {
      complianceDueSoon++
    } else {
      complianceClear++
    }
  }

  const kpis: KpiCard[] = [
    { label: t('activeLoads'),        value: activeLoads,                          sub: t('totalLoads', { count: loadsRes.count ?? 0 }),        icon: 'local_shipping', color: '#f97316' },
    { label: t('revenueThisMonth'),   value: formatMoney(revenueMtd, 'USD', locale), sub: t('revenueThisMonthSub'),                               icon: 'payments',       color: '#16a34a' },
    { label: t('outstandingInvoices'), value: formatMoney(outstandingAmount, 'USD', locale), sub: t('outstandingInvoicesSub', { count: outstandingCount }), icon: 'receipt_long', color: '#d97706' },
    { label: t('avgRatePerLoad'),     value: formatMoney(avgRate, 'USD', locale),   sub: t('avgRatePerLoadSub', { count: rateRows.length }),     icon: 'trending_up',   color: '#3b82f6' },
  ]

  const breakdowns: BreakdownCard[] = [
    {
      label: t('fleetStatus'),
      icon: 'fire_truck',
      color: '#1abc9c',
      primary: { label: t('fleetActive'), value: fleetActive },
      stats: [
        { label: t('fleetActive'), value: fleetActive, color: '#16a34a' },
        { label: t('fleetIdle'), value: fleetIdle, color: '#64748b' },
        { label: t('fleetInShop'), value: fleetInShop, color: '#d97706' },
      ],
    },
    {
      label: t('driverCompliance'),
      icon: 'person',
      color: '#3b82f6',
      primary: { label: t('complianceClear'), value: complianceClear },
      stats: [
        { label: t('complianceClear'), value: complianceClear, color: '#16a34a' },
        { label: t('complianceDueSoon'), value: complianceDueSoon, color: '#d97706' },
        { label: t('complianceIncomplete'), value: complianceIncomplete, color: '#dc2626' },
      ],
    },
  ]

  return (
    <div className={embedded ? '' : 'p-8'}>
      <ExceptionsBanner orgId={orgId} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
            <div className="flex items-start justify-between mb-3">
              <span className="text-slate-400 text-sm font-medium">{kpi.label}</span>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${kpi.color}20` }}>
                <span className="material-symbols-outlined text-[18px]" style={{ color: kpi.color }}>{kpi.icon}</span>
              </div>
            </div>
            <p className="text-3xl font-extrabold text-white tracking-tight">{kpi.value}</p>
            {kpi.sub && <p className="text-slate-500 text-xs mt-1">{kpi.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {breakdowns.map((card) => (
          <div key={card.label} className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
            <div className="flex items-start justify-between mb-3">
              <span className="text-slate-400 text-sm font-medium">{card.label}</span>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${card.color}20` }}>
                <span className="material-symbols-outlined text-[18px]" style={{ color: card.color }}>{card.icon}</span>
              </div>
            </div>
            <div className="flex items-baseline gap-2 mb-3">
              <p className="text-3xl font-extrabold text-white tracking-tight">{card.primary.value}</p>
              <span className="text-slate-500 text-xs">{card.primary.label}</span>
            </div>
            <div className="flex items-center gap-4">
              {card.stats.map((stat) => (
                <div key={stat.label} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stat.color }} />
                  <span className="text-slate-300 text-xs">{stat.value} {stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white/5 border border-white/8 rounded-xl shadow-card-dark">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-white font-medium text-sm">{t('recentLoads')}</h2>
          <a href="/loads" className="text-[#f97316] text-xs hover:underline rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">{t('viewAll')}</a>
        </div>
        {recentLoads.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <span className="material-symbols-outlined text-slate-600 text-4xl">local_shipping</span>
            <p className="text-slate-500 text-sm mt-3">{t('noLoadsYet')}</p>
            <a href="/loads/new" className="inline-block mt-4 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
              {t('createFirstLoad')}
            </a>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {recentLoads.map((load) => {
              const badge = (load.status ? STATUS_BADGE[load.status] : null) ?? STATUS_BADGE.draft
              const route =
                [load.pickup_city, load.pickup_state].filter(Boolean).join(', ') +
                ' → ' +
                [load.delivery_city, load.delivery_state].filter(Boolean).join(', ')

              return (
                <Link
                  key={load.id}
                  href={`/loads/${load.load_number}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.07] hover:shadow-hover-dark transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-white font-medium">{load.load_number}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="text-slate-400 text-sm max-w-[160px] truncate">{load.customer_name_raw ?? '—'}</span>
                    <span className="text-slate-300 text-sm max-w-[220px] truncate hidden sm:inline">{route}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
