// app/(app)/finance/page.tsx
// Pro Finance & IFTA Hub (mockup-17) — Critical gap: this was an 8-line
// "Coming soon" stub. Pro-tier only (hasFeature('ifta_tax_hub')); Growth
// carriers keep the miles-only IFTA view (app/(app)/loads and the mobile
// Reports tab, see src/components/ifta-summary.tsx) and see an upgrade
// prompt here, same posture as settlements/page.tsx's own tier gate.
//
// Rule D self-critique (docs/architecture-principles.md), same trade-off
// already flagged on app/api/admin/orgs/route.ts's health-score: fuel
// cost/mile-by-driver and revenue/mile-by-lane are computed here via
// parallel TypeScript queries rather than a SQL function, since neither
// formula is stable/reused elsewhere yet. Not a template for future pages —
// a candidate to move into a SECURITY DEFINER function once the shape
// settles, per Rule D.
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import { formatMoney } from '@/lib/format-money'
import { hasFeature } from '@/lib/entitlements'
import { invoiceStatusVariant, type InvoiceStatus } from '@/lib/domain/invoice-status'
import { Card, CardHeader, CardBody, KpiTile, StatusBadge, Table, TableHeaderCell, TableRow, TableCell, EmptyState, ProgressBar } from '@/components/ui'
import { BRAND_ORANGE, DANGER, SUCCESS, WARNING } from '@/lib/design-tokens'

const STAFF_ROLES = ['owner', 'solo', 'finance']

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <CardHeader>
      <div>
        <h2 className="text-text-pri font-medium text-sm">{title}</h2>
        {subtitle && <p className="text-text-sec text-xs mt-0.5">{subtitle}</p>}
      </div>
    </CardHeader>
  )
}

function currentQuarter(): { label: string; startMonth: number; year: number } {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  return { label: `Q${q + 1} ${now.getFullYear()}`, startMonth: q * 3, year: now.getFullYear() }
}

export default async function FinancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) redirect('/onboarding')
  if (!STAFF_ROLES.includes(profile.role)) redirect('/dashboard')

  const t = await getTranslations('finance')
  const tInvoices = await getTranslations('invoices')
  const locale = await getLocale()
  const entitled = await hasFeature(supabase, 'ifta_tax_hub')

  if (!entitled) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-text-pri mb-4">{t('title')}</h1>
        <Card>
          <EmptyState icon="payments" title={t('upgradeRequired')} description={t('upgradeRequiredDetail')} />
        </Card>
      </div>
    )
  }

  const orgId = profile.org_id
  const quarter = currentQuarter()
  const quarterStart = new Date(quarter.year, quarter.startMonth, 1)
  const quarterKey = `${quarter.year}-Q${Math.floor(quarter.startMonth / 3) + 1}`

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const [
    { data: iftaRows },
    { data: invoiceRows },
    { data: allInvoiceRows },
    { data: settlementRows },
    { data: fuelRows },
    { data: laneRows },
  ] = await Promise.all([
    supabase.rpc('get_ifta_tax_summary', { p_carrier_org_id: orgId, p_quarter: quarterKey }),
    // Recent-8 for the pipeline table below — display only, not the KPI math.
    supabase
      .from('invoices')
      .select('id, invoice_number, amount, status, due_date, sent_at, opened_at')
      .order('created_at', { ascending: false })
      .limit(8),
    // Full, unfiltered set for KPI math — the pipeline table's 8-row limit
    // must not silently cap revenueMTD/outstanding/aging (a real bug this
    // fixes: those were previously computed off the same 8-row sample above).
    supabase
      .from('invoices')
      .select('amount, status, due_date, sent_at, paid_at'),
    supabase
      .from('driver_settlements')
      .select('id, net_pay, payment_status, drivers(driver_number, profiles(first_name, last_name))')
      .gte('period_start', quarterStart.toISOString().slice(0, 10))
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('fuel_stops')
      .select('gallons, total_cost, driver_id, drivers(driver_number, profiles(first_name, last_name))')
      .gte('stop_date', quarterStart.toISOString().slice(0, 10)),
    supabase
      .from('loads')
      .select('pickup_city, pickup_state, delivery_city, delivery_state, rate, total_miles')
      .not('rate', 'is', null)
      .not('total_miles', 'is', null)
      .gte('created_at', quarterStart.toISOString()),
  ])

  const ifta = iftaRows ?? []
  const invoices = invoiceRows ?? []
  const settlements = settlementRows ?? []
  const allInvoices = allInvoiceRows ?? []

  const totalTaxDue = ifta.reduce((sum: number, r: { net_tax_due: number }) => sum + Number(r.net_tax_due), 0)
  const totalMilesIfta = ifta.reduce((sum: number, r: { miles_in_state: number }) => sum + Number(r.miles_in_state), 0)

  // Revenue MTD: paid THIS calendar month — computed off allInvoices (not
  // the 8-row pipeline sample), matching dashboard/FinanceView.tsx's own
  // revenueMTD definition so the two pages can't quote different numbers
  // for what should be the same figure.
  const revenueMTD = allInvoices
    .filter(i => i.status === 'paid' && i.paid_at && i.paid_at >= startOfMonth.toISOString() && i.paid_at < startOfNextMonth.toISOString())
    .reduce((sum, i) => sum + Number(i.amount), 0)
  const outstandingInvoices = allInvoices.filter(i => i.status === 'sent' || i.status === 'overdue')
  const outstanding = outstandingInvoices.reduce((sum, i) => sum + Number(i.amount), 0)
  const overdueInvoices = allInvoices.filter(i => i.status === 'overdue')
  const overdueAmount = overdueInvoices.reduce((sum, i) => sum + Number(i.amount), 0)
  const overdueCount = overdueInvoices.length

  // Avg days-to-pay: paid invoices with both sent_at and paid_at on file.
  const paidWithDates = allInvoices.filter(i => i.status === 'paid' && i.sent_at && i.paid_at)
  const avgDaysToPay = paidWithDates.length > 0
    ? paidWithDates.reduce((sum, i) => sum + (new Date(i.paid_at!).getTime() - new Date(i.sent_at!).getTime()) / 86_400_000, 0) / paidWithDates.length
    : null

  // Invoice aging — same bucketing as dashboard/FinanceView.tsx's Finance
  // role view, reused here rather than re-derived so the two pages agree.
  const agingBuckets = { current: 0, days30: 0, days60: 0, days90: 0 }
  const agingCounts = { current: 0, days30: 0, days60: 0, days90: 0 }
  for (const inv of outstandingInvoices) {
    const amount = Number(inv.amount ?? 0)
    let daysPastDue = -1
    if (inv.due_date) {
      daysPastDue = Math.floor((now.getTime() - new Date(inv.due_date).getTime()) / 86_400_000)
    }
    if (daysPastDue >= 90) { agingBuckets.days90 += amount; agingCounts.days90++ }
    else if (daysPastDue >= 60) { agingBuckets.days60 += amount; agingCounts.days60++ }
    else if (daysPastDue >= 30) { agingBuckets.days30 += amount; agingCounts.days30++ }
    else { agingBuckets.current += amount; agingCounts.current++ }
  }
  const tDashboard = await getTranslations('dashboard')
  const agingRows = [
    { label: tDashboard('agingCurrent'), amount: agingBuckets.current, count: agingCounts.current, color: SUCCESS },
    { label: tDashboard('aging30'), amount: agingBuckets.days30, count: agingCounts.days30, color: WARNING },
    { label: tDashboard('aging60'), amount: agingBuckets.days60, count: agingCounts.days60, color: BRAND_ORANGE },
    { label: tDashboard('aging90'), amount: agingBuckets.days90, count: agingCounts.days90, color: DANGER },
  ]

  // Fuel cost/mile by driver — miles come from that driver's loads in the
  // same window, not the fuel stop rows themselves (a fuel stop has no
  // mileage of its own).
  const driverMilesByDriverId = new Map<number, number>()
  if (fuelRows && fuelRows.length > 0) {
    const driverIds = [...new Set(fuelRows.map(f => f.driver_id).filter((id): id is number => id != null))]
    if (driverIds.length > 0) {
      const { data: driverLoads } = await supabase
        .from('loads')
        .select('driver_id, total_miles')
        .in('driver_id', driverIds)
        .gte('created_at', quarterStart.toISOString())
      for (const row of driverLoads ?? []) {
        if (row.driver_id == null) continue
        driverMilesByDriverId.set(row.driver_id, (driverMilesByDriverId.get(row.driver_id) ?? 0) + Number(row.total_miles ?? 0))
      }
    }
  }

  const fuelByDriver = new Map<number, { name: string; cost: number; gallons: number }>()
  for (const f of fuelRows ?? []) {
    if (f.driver_id == null) continue
    const existing = fuelByDriver.get(f.driver_id) ?? {
      name: [f.drivers?.profiles?.first_name, f.drivers?.profiles?.last_name].filter(Boolean).join(' ') || f.drivers?.driver_number || '—',
      cost: 0,
      gallons: 0,
    }
    existing.cost += Number(f.total_cost)
    existing.gallons += Number(f.gallons)
    fuelByDriver.set(f.driver_id, existing)
  }
  const fuelCostPerMile = [...fuelByDriver.entries()]
    .map(([driverId, v]) => {
      const miles = driverMilesByDriverId.get(driverId) ?? 0
      return { name: v.name, costPerMile: miles > 0 ? v.cost / miles : null }
    })
    .filter(r => r.costPerMile != null)
    .sort((a, b) => (b.costPerMile ?? 0) - (a.costPerMile ?? 0))
    .slice(0, 6)
  const fleetAvgCostPerMile = fuelCostPerMile.length > 0
    ? fuelCostPerMile.reduce((s, r) => s + (r.costPerMile ?? 0), 0) / fuelCostPerMile.length
    : null

  // Revenue/mile by lane — grouped by origin/destination city+state pair.
  const laneMap = new Map<string, { origin: string; destination: string; loads: number; totalRatePerMile: number }>()
  for (const l of laneRows ?? []) {
    if (!l.total_miles || Number(l.total_miles) <= 0) continue
    const origin = [l.pickup_city, l.pickup_state].filter(Boolean).join(', ')
    const destination = [l.delivery_city, l.delivery_state].filter(Boolean).join(', ')
    const key = `${origin} -> ${destination}`
    const rpm = Number(l.rate) / Number(l.total_miles)
    const existing = laneMap.get(key) ?? { origin, destination, loads: 0, totalRatePerMile: 0 }
    existing.loads += 1
    existing.totalRatePerMile += rpm
    laneMap.set(key, existing)
  }
  const lanes = [...laneMap.values()]
    .map(l => ({ ...l, avgRatePerMile: l.totalRatePerMile / l.loads }))
    .sort((a, b) => b.avgRatePerMile - a.avgRatePerMile)
    .slice(0, 6)

  return (
    <div className="p-8 flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
        <p className="text-text-sec text-sm mt-1">{quarter.label}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiTile label={t('kpiRevenue')} value={formatMoney(revenueMTD, 'USD', locale)} helperText={t('kpiRevenueSub')} />
        <KpiTile label={t('kpiOutstanding')} value={formatMoney(outstanding, 'USD', locale)} helperText={t('kpiOverdueCount', { count: overdueCount })} />
        <KpiTile label={t('kpiOverdueAmount')} value={formatMoney(overdueAmount, 'USD', locale)} helperText={t('kpiOverdueAmountSub', { count: overdueCount })} />
        <KpiTile
          label={t('kpiRevenuePerMile')}
          value={totalMilesIfta > 0 ? formatMoney(revenueMTD / totalMilesIfta, 'USD', locale) : '—'}
          helperText={t('kpiRevenuePerMileSub', { miles: Math.round(totalMilesIfta) })}
        />
        <KpiTile label={t('kpiIftaTaxDue')} value={formatMoney(totalTaxDue, 'USD', locale)} helperText={t('kpiIftaTaxDueSub')} />
        <KpiTile
          label={t('kpiAvgDaysToPay')}
          value={avgDaysToPay != null ? t('kpiAvgDaysToPayValue', { days: Math.round(avgDaysToPay) }) : '—'}
          helperText={t('kpiAvgDaysToPaySub', { count: paidWithDates.length })}
        />
      </div>

      <Card>
        <SectionHeader title={t('invoiceAgingTitle')} subtitle={t('invoiceAgingSub')} />
        {outstandingInvoices.length === 0 ? (
          <EmptyState icon="receipt_long" title={tDashboard('agingNoneOutstanding')} />
        ) : (
          <div className="divide-y divide-divider-ui">
            {agingRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: row.color }} />
                  <span className="text-text-sec text-sm">{row.label}</span>
                  <span className="text-text-mut text-xs">({row.count})</span>
                </div>
                <span className="text-text-pri text-sm font-medium">{formatMoney(row.amount, 'USD', locale)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <SectionHeader title={t('iftaBreakdownTitle')} subtitle={t('iftaBreakdownSub', { quarter: quarter.label })} />
          <CardBody>
            {ifta.length === 0 ? (
              <EmptyState icon="route" title={t('iftaNoData')} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <TableHeaderCell>{t('colState')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('colMiles')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('colNetDue')}</TableHeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {ifta.map((row: { state: string; miles_in_state: number; net_tax_due: number }) => (
                    <TableRow key={row.state}>
                      <TableCell>{row.state}</TableCell>
                      <TableCell numeric>{Math.round(Number(row.miles_in_state)).toLocaleString()}</TableCell>
                      <TableCell numeric>{formatMoney(row.net_tax_due, 'USD', locale)}</TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-1">
          <SectionHeader title={t('invoicePipelineTitle')} subtitle={t('invoicePipelineSub', { count: invoices.length })} />
          <CardBody>
            {invoices.length === 0 ? (
              <EmptyState icon="receipt_long" title={t('noInvoices')} />
            ) : (
              <div className="flex flex-col gap-3">
                {invoices.map(inv => (
                  <div key={inv.id} className="flex items-center justify-between text-sm">
                    <div>
                      <div className="text-text-pri font-medium">{inv.invoice_number}</div>
                      <div className="text-text-sec text-xs flex items-center gap-1.5">
                        {inv.due_date ?? '—'}
                        {inv.opened_at && (
                          <span className="inline-flex items-center gap-0.5 text-success">
                            <span className="material-symbols-outlined text-[12px]">visibility</span>
                            {t('invoiceOpened')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge variant={invoiceStatusVariant(inv.status as InvoiceStatus)}>{tInvoices(`status_${inv.status}` as 'status_draft')}</StatusBadge>
                      <span className="text-text-pri font-semibold">{formatMoney(inv.amount, 'USD', locale)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-1">
          <SectionHeader title={t('settlementsTitle')} subtitle={t('settlementsSub', { quarter: quarter.label })} />
          <CardBody>
            {settlements.length === 0 ? (
              <EmptyState icon="account_balance" title={t('noSettlements')} />
            ) : (
              <div className="flex flex-col gap-3">
                {settlements.map(s => {
                  const name = [s.drivers?.profiles?.first_name, s.drivers?.profiles?.last_name].filter(Boolean).join(' ') || s.drivers?.driver_number || '—'
                  return (
                    <div key={s.id} className="flex items-center justify-between text-sm">
                      <span className="text-text-pri">{name}</span>
                      <span className="text-text-pri font-semibold">{formatMoney(s.net_pay, 'USD', locale)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <SectionHeader title={t('fuelCostTitle')} subtitle={fleetAvgCostPerMile != null ? t('fuelCostSub', { avg: formatMoney(fleetAvgCostPerMile, 'USD', locale) }) : undefined} />
          <CardBody>
            {fuelCostPerMile.length === 0 ? (
              <EmptyState icon="local_gas_station" title={t('noFuelData')} />
            ) : (
              <div className="flex flex-col gap-3">
                {fuelCostPerMile.map(r => (
                  <div key={r.name} className="flex items-center gap-3">
                    <span className="text-text-pri text-sm w-28 truncate">{r.name}</span>
                    <div className="flex-1"><ProgressBar value={fleetAvgCostPerMile ? Math.min(100, ((r.costPerMile ?? 0) / (fleetAvgCostPerMile * 2)) * 100) : 0} /></div>
                    <span className="text-text-pri text-sm font-semibold w-16 text-right">{formatMoney(r.costPerMile, 'USD', locale)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <SectionHeader title={t('laneRevenueTitle')} subtitle={t('laneRevenueSub')} />
          <CardBody>
            {lanes.length === 0 ? (
              <EmptyState icon="route" title={t('noLaneData')} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <TableHeaderCell>{t('colLane')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('colLoads')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('colRatePerMile')}</TableHeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {lanes.map(l => (
                    <TableRow key={`${l.origin}-${l.destination}`}>
                      <TableCell>{l.origin} → {l.destination}</TableCell>
                      <TableCell numeric>{l.loads}</TableCell>
                      <TableCell numeric>{formatMoney(l.avgRatePerMile, 'USD', locale)}</TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
