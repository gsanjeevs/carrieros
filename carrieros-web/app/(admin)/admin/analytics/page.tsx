'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button, Card, EmptyState, Input, KpiTile, StatusBadge, Table, TableCell, TableHeaderCell, TableRow } from '@/components/ui'

type FleetBand = 'no_active_vehicles' | '1_vehicle' | '2_5_vehicles' | '6_20_vehicles' | '21_plus_vehicles'
type Tier = 'starter' | 'growth' | 'pro' | 'enterprise'

interface Carrier {
  org_id: number
  name: string
  created_at: string | null
  tier: Tier
  billing_status: string
  fleet_band: FleetBand
  active_users: number
  active_vehicles: number
  active_drivers: number
  customer_accounts: number
  loads_last_30d: number
  loads_previous_30d: number
  loads_per_active_vehicle: number | null
  invoices_last_30d: number
  open_support_tickets: number
  cohort_carriers: number
  cohort_median_loads_per_vehicle: number | null
}

interface ResponseData {
  carriers: Carrier[]
  summary: { total_carriers: number; active_billing_carriers: number; trialing_carriers: number; past_due_carriers: number }
  has_more: boolean
}

const PAGE_SIZE = 50
const TIERS: Array<Tier | ''> = ['', 'starter', 'growth', 'pro', 'enterprise']
const FLEET_BANDS: Array<FleetBand | ''> = ['', 'no_active_vehicles', '1_vehicle', '2_5_vehicles', '6_20_vehicles', '21_plus_vehicles']

function trend(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 100)
}

export default function AdminAnalyticsPage() {
  const t = useTranslations('admin.analytics')
  const [tier, setTier] = useState<Tier | ''>('')
  const [fleetBand, setFleetBand] = useState<FleetBand | ''>('')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [summary, setSummary] = useState<ResponseData['summary']>({ total_carriers: 0, active_billing_carriers: 0, trialing_carriers: 0, past_due_carriers: 0 })
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
    if (tier) params.set('tier', tier)
    if (fleetBand) params.set('fleet_band', fleetBand)
    if (search) params.set('q', search)
    fetch(`/api/admin/analytics?${params}`)
      .then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<ResponseData> })
      .then(data => {
        if (cancelled) return
        setCarriers(current => page === 0 ? data.carriers : [...current, ...data.carriers])
        setSummary(data.summary)
        setHasMore(data.has_more)
      })
      .catch(() => { if (!cancelled) setError(t('error')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [page, tier, fleetBand, search, t])

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextSearch = searchDraft.trim()
    setCarriers([])
    setPage(0)
    setLoading(true)
    setError('')
    setSearch(nextSearch)
  }

  function changeFilter(nextTier: Tier | '', nextFleet: FleetBand | '') {
    setCarriers([])
    setPage(0)
    setLoading(true)
    setError('')
    setTier(nextTier)
    setFleetBand(nextFleet)
  }

  return (
    <div className="p-8 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-text-pri mb-1">{t('title')}</h1>
        <p className="text-text-sec text-sm">{t('subtitle')}</p>
      </header>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiTile label={t('carriers')} value={summary.total_carriers} />
        <KpiTile label={t('activeBilling')} value={summary.active_billing_carriers} />
        <KpiTile label={t('trialing')} value={summary.trialing_carriers} />
        <KpiTile label={t('pastDue')} value={summary.past_due_carriers} />
      </div>

      <Card className="p-4">
        <p className="text-sm text-text-sec">{t('methodNote')}</p>
      </Card>

      <div className="flex flex-wrap gap-3 items-center">
        <Input as="select" value={tier} aria-label={t('tierFilter')} onChange={event => changeFilter(event.target.value as Tier | '', fleetBand)} className="w-auto">
          {TIERS.map(value => <option key={value || 'all'} value={value}>{value ? value[0].toUpperCase() + value.slice(1) : t('allTiers')}</option>)}
        </Input>
        <Input as="select" value={fleetBand} aria-label={t('fleetFilter')} onChange={event => changeFilter(tier, event.target.value as FleetBand | '')} className="w-auto">
          {FLEET_BANDS.map(value => <option key={value || 'all'} value={value}>{value ? t(`fleet.${value}`) : t('allFleetSizes')}</option>)}
        </Input>
        <form className="flex gap-2 ml-auto" onSubmit={applySearch}>
          <Input value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} />
          <Button type="submit" variant="secondary">{t('search')}</Button>
        </form>
      </div>

      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      <Card>
        {!loading && carriers.length === 0 ? <EmptyState icon="query_stats" title={t('empty')} /> : (
          <Table>
            <thead><tr>
              <TableHeaderCell>{t('carrier')}</TableHeaderCell>
              <TableHeaderCell>{t('segment')}</TableHeaderCell>
              <TableHeaderCell>{t('billing')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('capacity')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('loads30d')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('loadsPerVehicle')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('cohort')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('support')}</TableHeaderCell>
            </tr></thead>
            <tbody>{carriers.map(carrier => {
              const change = trend(carrier.loads_last_30d, carrier.loads_previous_30d)
              return <TableRow key={carrier.org_id}>
                <TableCell>
                  <Link href={`/admin/orgs/${carrier.org_id}`} className="font-medium text-text-pri hover:text-brand-orange">{carrier.name}</Link>
                  <span className="block text-xs text-text-mut">{t('carrierUsers', { users: carrier.active_users, customers: carrier.customer_accounts })}</span>
                </TableCell>
                <TableCell className="capitalize">{carrier.tier} · {t(`fleet.${carrier.fleet_band}`)}</TableCell>
                <TableCell><StatusBadge size="sm" variant={carrier.billing_status === 'past_due' ? 'danger' : carrier.billing_status === 'active' ? 'success' : 'warning'}>{carrier.billing_status}</StatusBadge></TableCell>
                <TableCell numeric>{t('capacityValue', { vehicles: carrier.active_vehicles, drivers: carrier.active_drivers })}</TableCell>
                <TableCell numeric>
                  {carrier.loads_last_30d}
                  <span className="block text-xs text-text-mut">{change === null ? t('newActivity') : t('changeVsPrevious', { percent: change, previous: carrier.loads_previous_30d })}</span>
                </TableCell>
                <TableCell numeric>{carrier.loads_per_active_vehicle ?? '—'}</TableCell>
                <TableCell numeric>
                  {carrier.cohort_median_loads_per_vehicle ?? '—'}
                  <span className="block text-xs text-text-mut">{t('cohortSize', { count: carrier.cohort_carriers })}</span>
                </TableCell>
                <TableCell numeric>{carrier.open_support_tickets || '—'}</TableCell>
              </TableRow>
            })}</tbody>
          </Table>
        )}
      </Card>
      <div className="flex justify-center">
        {loading && <p className="text-xs text-text-mut">{t('loading')}</p>}
        {!loading && hasMore && <Button variant="secondary" onClick={() => { setLoading(true); setError(''); setPage(value => value + 1) }}>{t('loadMore')}</Button>}
      </div>
    </div>
  )
}
