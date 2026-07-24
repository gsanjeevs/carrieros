// app/(app)/dashboard/OwnerView.tsx
// The full-visibility dashboard: all 4 KPIs + Fleet Status + Driver
// Compliance breakdowns + Recent Loads. Used directly by Owner, and
// composed (with a "My Load Today" card prepended) by SoloView.
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { formatMoney } from '@/lib/format-money'
import ExceptionsBanner from './ExceptionsBanner'
import { loadStatusVariant, type LoadStatus } from '@/lib/domain/load-status'
import StatusBadge from '@/components/ui/StatusBadge'
import { Card, CardHeader, CardBody, KpiTile } from '@/components/ui'
import { BRAND_BLUE, BRAND_ORANGE, DANGER, SLATE, SUCCESS, TEAL, WARNING } from '@/lib/design-tokens'
import { listLoadIdsAndStatusForOrg, listRecentLoadsForOrg, getLoadsRateForOrg } from '@/lib/queries/loads'

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

export default async function OwnerView({ orgId, embedded = false }: { orgId: number | undefined; embedded?: boolean }) {
  const supabase = await createClient()
  const t = await getTranslations('dashboard')
  const tLoads = await getTranslations('loads')
  const locale = await getLocale()
  const statusLabel = (status: string) => tLoads(`status_${status}` as never)

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
      ? listLoadIdsAndStatusForOrg(supabase, orgId)
      : Promise.resolve({ count: 0, data: [] }),
    orgId
      ? listRecentLoadsForOrg(supabase, orgId, 5)
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
    // Avg rate/load: exclude cancelled/declined loads — neither one's rate
    // was ever actually earned, so including either would understate the
    // average.
    orgId
      ? getLoadsRateForOrg(supabase, orgId)
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
    { label: t('activeLoads'),        value: activeLoads,                          sub: t('totalLoads', { count: loadsRes.count ?? 0 }),        icon: 'local_shipping', color: BRAND_ORANGE },
    { label: t('revenueThisMonth'),   value: formatMoney(revenueMtd, 'USD', locale), sub: t('revenueThisMonthSub'),                               icon: 'payments',       color: SUCCESS },
    { label: t('outstandingInvoices'), value: formatMoney(outstandingAmount, 'USD', locale), sub: t('outstandingInvoicesSub', { count: outstandingCount }), icon: 'receipt_long', color: WARNING },
    { label: t('avgRatePerLoad'),     value: formatMoney(avgRate, 'USD', locale),   sub: t('avgRatePerLoadSub', { count: rateRows.length }),     icon: 'trending_up',   color: BRAND_BLUE },
  ]

  const breakdowns: BreakdownCard[] = [
    {
      label: t('fleetStatus'),
      icon: 'fire_truck',
      color: TEAL,
      primary: { label: t('fleetActive'), value: fleetActive },
      stats: [
        { label: t('fleetActive'), value: fleetActive, color: SUCCESS },
        { label: t('fleetIdle'), value: fleetIdle, color: SLATE },
        { label: t('fleetInShop'), value: fleetInShop, color: WARNING },
      ],
    },
    {
      label: t('driverCompliance'),
      icon: 'person',
      color: BRAND_BLUE,
      primary: { label: t('complianceClear'), value: complianceClear },
      stats: [
        { label: t('complianceClear'), value: complianceClear, color: SUCCESS },
        { label: t('complianceDueSoon'), value: complianceDueSoon, color: WARNING },
        { label: t('complianceIncomplete'), value: complianceIncomplete, color: DANGER },
      ],
    },
  ]

  return (
    <div className={embedded ? '' : 'p-8'}>
      <ExceptionsBanner orgId={orgId} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => (
          <KpiTile key={kpi.label} label={kpi.label} value={kpi.value} helperText={kpi.sub} />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {breakdowns.map((card) => (
          <Card key={card.label} className="p-5">
            <div className="flex items-start justify-between mb-3">
              <span className="text-text-sec text-sm font-medium">{card.label}</span>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${card.color}20` }}>
                <span className="material-symbols-outlined text-[18px]" style={{ color: card.color }}>{card.icon}</span>
              </div>
            </div>
            <div className="flex items-baseline gap-2 mb-3">
              <p className="text-3xl font-extrabold text-text-pri tracking-tight">{card.primary.value}</p>
              <span className="text-text-mut text-xs">{card.primary.label}</span>
            </div>
            <div className="flex items-center gap-4">
              {card.stats.map((stat) => (
                <div key={stat.label} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stat.color }} />
                  <span className="text-text-sec text-xs">{stat.value} {stat.label}</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-text-pri font-medium text-sm">{t('recentLoads')}</h2>
          <Link href="/loads" className="text-brand-orange text-xs hover:underline rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">{t('viewAll')}</Link>
        </CardHeader>
        {recentLoads.length === 0 ? (
          <CardBody className="py-12 text-center">
            <span className="material-symbols-outlined text-text-mut text-4xl">local_shipping</span>
            <p className="text-text-mut text-sm mt-3">{t('noLoadsYet')}</p>
            <Link href="/loads/new" className="inline-block mt-4 px-4 py-2 bg-brand-orange hover:bg-brand-orange/90 text-white text-sm font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
              {t('createFirstLoad')}
            </Link>
          </CardBody>
        ) : (
          <div className="divide-y divide-divider-ui">
            {recentLoads.map((load) => {
              const statusKey = (load.status ?? 'draft') as LoadStatus
              const route =
                [load.pickup_city, load.pickup_state].filter(Boolean).join(', ') +
                ' → ' +
                [load.delivery_city, load.delivery_state].filter(Boolean).join(', ')

              return (
                <Link
                  key={load.id}
                  href={`/loads/${load.load_number}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-surface-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-text-pri font-medium">{load.load_number}</span>
                    <StatusBadge variant={loadStatusVariant(statusKey)} size="sm">
                      {statusLabel(statusKey)}
                    </StatusBadge>
                  </div>
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="text-text-sec text-sm max-w-[160px] truncate">{load.customer_name_raw ?? '—'}</span>
                    <span className="text-text-sec text-sm max-w-[220px] truncate hidden sm:inline">{route}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
