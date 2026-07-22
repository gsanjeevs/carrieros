// app/(app)/dashboard/DispatcherView.tsx
// Ops-board emphasis: what's moving and what's available. Dispatchers are
// consistently excluded from rate/revenue visibility throughout this app
// (see app/(app)/loads/page.tsx's `showRate` gate), so this view omits
// Revenue MTD / Outstanding Invoices / Avg Rate entirely.
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { STATUS_COLOR } from './OwnerView'
import ExceptionsBanner from './ExceptionsBanner'

export default async function DispatcherView({ orgId }: { orgId: number | undefined }) {
  const supabase = await createClient()
  const t = await getTranslations('dashboard')
  const tLoads = await getTranslations('loads')

  const STATUS_BADGE: Record<string, { label: string; color: string }> = Object.fromEntries(
    Object.entries(STATUS_COLOR).map(([key, color]) => [key, { label: tLoads(`status_${key}`), color }])
  )

  const [loadsRes, recentLoadsRes, fleetStatusRes] = await Promise.all([
    orgId
      ? supabase.from('loads').select('id, status', { count: 'exact' }).eq('carrier_org_id', orgId)
      : Promise.resolve({ count: 0, data: [] }),
    orgId
      ? supabase
          .from('loads')
          .select('id, load_number, status, pickup_city, pickup_state, delivery_city, delivery_state, customer_name_raw')
          .eq('carrier_org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
    orgId
      ? supabase.from('vehicles').select('status').eq('carrier_org_id', orgId).eq('is_active', true)
      : Promise.resolve({ data: [] }),
  ])

  const recentLoads = recentLoadsRes.data ?? []

  const activeLoads = (loadsRes.data ?? []).filter(
    (l: { status: string | null }) =>
      l.status !== null && ['dispatched', 'picked_up', 'in_transit'].includes(l.status)
  ).length

  const fleetRows = (fleetStatusRes.data ?? []) as { status: string | null }[]
  const fleetActive = fleetRows.filter((v) => v.status === 'active').length
  const fleetIdle = fleetRows.filter((v) => v.status === 'idle').length
  const fleetInShop = fleetRows.filter((v) => v.status === 'in_shop').length

  return (
    <div className="p-8">
      <ExceptionsBanner orgId={orgId} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
          <div className="flex items-start justify-between mb-3">
            <span className="text-slate-400 text-sm font-medium">{t('activeLoads')}</span>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#f9731620' }}>
              <span className="material-symbols-outlined text-[18px]" style={{ color: '#f97316' }}>local_shipping</span>
            </div>
          </div>
          <p className="text-3xl font-extrabold text-white tracking-tight">{activeLoads}</p>
          <p className="text-slate-500 text-xs mt-1">{t('totalLoads', { count: loadsRes.count ?? 0 })}</p>
        </div>

        <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
          <div className="flex items-start justify-between mb-3">
            <span className="text-slate-400 text-sm font-medium">{t('fleetStatus')}</span>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#1abc9c20' }}>
              <span className="material-symbols-outlined text-[18px]" style={{ color: '#1abc9c' }}>fire_truck</span>
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <p className="text-3xl font-extrabold text-white tracking-tight">{fleetActive}</p>
            <span className="text-slate-500 text-xs">{t('fleetActive')}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#16a34a' }} />
              <span className="text-slate-300 text-xs">{fleetActive} {t('fleetActive')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#64748b' }} />
              <span className="text-slate-300 text-xs">{fleetIdle} {t('fleetIdle')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#d97706' }} />
              <span className="text-slate-300 text-xs">{fleetInShop} {t('fleetInShop')}</span>
            </div>
          </div>
        </div>
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
