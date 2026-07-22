// app/(app)/dashboard/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'

interface KpiCard {
  label: string
  value: string | number
  sub?: string
  color?: string
  icon: string
}

// Mirrors app/(app)/loads/page.tsx's STATUS_COLOR — this codebase keeps a
// local copy per page rather than sharing one constant (see also
// app/(app)/loads/[load_number]/page.tsx, app/track/[token]/page.tsx).
const STATUS_COLOR: Record<string, string> = {
  draft:       'bg-slate-500/20 text-slate-400',
  scheduled:   'bg-blue-500/20 text-blue-400',
  dispatched:  'bg-[#f97316]/20 text-[#f97316]',
  picked_up:   'bg-amber-500/20 text-amber-400',
  in_transit:  'bg-[#1abc9c]/20 text-[#1abc9c]',
  delivered:   'bg-[#16a34a]/20 text-[#16a34a]',
  invoiced:    'bg-purple-500/20 text-purple-400',
  paid:        'bg-[#16a34a]/20 text-[#16a34a]',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, first_name, last_name, org_id')
    .eq('id', user.id)
    .single()

  const role    = profile?.role ?? 'solo'
  const orgId   = profile?.org_id

  const t = await getTranslations('dashboard')
  const tLoads = await getTranslations('loads')
  const tNav = await getTranslations('nav')
  const locale = await getLocale()

  const STATUS_BADGE: Record<string, { label: string; color: string }> = Object.fromEntries(
    Object.entries(STATUS_COLOR).map(([key, color]) => [key, { label: tLoads(`status_${key}`), color }])
  )

  const [loadsRes, vehiclesRes, driversRes, invoicesRes, recentLoadsRes] = await Promise.all([
    orgId
      ? supabase.from('loads').select('id, status', { count: 'exact' }).eq('carrier_org_id', orgId)
      : Promise.resolve({ count: 0, data: [] }),
    orgId
      ? supabase.from('vehicles').select('id', { count: 'exact' }).eq('carrier_org_id', orgId).eq('is_active', true)
      : Promise.resolve({ count: 0 }),
    orgId
      ? supabase.from('drivers').select('id', { count: 'exact' }).eq('carrier_org_id', orgId).eq('is_active', true)
      : Promise.resolve({ count: 0 }),
    orgId
      ? supabase.from('invoices').select('id, status', { count: 'exact' }).eq('carrier_org_id', orgId).eq('status', 'sent')
      : Promise.resolve({ count: 0 }),
    orgId
      ? supabase
          .from('loads')
          .select('id, load_number, status, pickup_city, pickup_state, delivery_city, delivery_state, customer_name_raw')
          .eq('carrier_org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
  ])

  const recentLoads = recentLoadsRes.data ?? []

  const activeLoads = (loadsRes.data ?? []).filter(
    (l: { status: string | null }) =>
      l.status !== null && ['dispatched','picked_up','in_transit'].includes(l.status)
  ).length

  const kpis: KpiCard[] = [
    { label: t('activeLoads'),    value: activeLoads,            sub: t('totalLoads', { count: loadsRes.count ?? 0 }),   icon: 'local_shipping', color: '#f97316' },
    { label: t('trucks'),         value: vehiclesRes.count ?? 0,   sub: t('activeFleet'),                                  icon: 'fire_truck',     color: '#1abc9c' },
    { label: t('drivers'),        value: driversRes.count ?? 0,  sub: t('active'),                                       icon: 'person',         color: '#3b82f6' },
    { label: t('unpaidInvoices'), value: invoicesRes.count ?? 0, sub: t('awaitingPayment'),                              icon: 'receipt_long',   color: '#d97706' },
  ]

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">
          {role === 'owner' || role === 'solo' ? t('title') : tNav('dashboard')}
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          {new Date().toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
            <div className="flex items-start justify-between mb-3">
              <span className="text-slate-400 text-sm font-medium">{kpi.label}</span>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${kpi.color}20` }}>
                <span className="material-symbols-outlined text-[18px]" style={{ color: kpi.color }}>{kpi.icon}</span>
              </div>
            </div>
            <p className="text-3xl font-bold text-white">{kpi.value}</p>
            {kpi.sub && <p className="text-slate-500 text-xs mt-1">{kpi.sub}</p>}
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
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
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
