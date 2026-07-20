// app/(app)/dashboard/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'

interface KpiCard {
  label: string
  value: string | number
  sub?: string
  color?: string
  icon: string
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
  const tNav = await getTranslations('nav')
  const locale = await getLocale()

  const [loadsRes, trucksRes, driversRes, invoicesRes] = await Promise.all([
    orgId
      ? supabase.from('loads').select('id, status', { count: 'exact' }).eq('carrier_org_id', orgId)
      : Promise.resolve({ count: 0, data: [] }),
    orgId
      ? supabase.from('trucks').select('id', { count: 'exact' }).eq('carrier_org_id', orgId).eq('is_active', true)
      : Promise.resolve({ count: 0 }),
    orgId
      ? supabase.from('drivers').select('id', { count: 'exact' }).eq('carrier_org_id', orgId).eq('is_active', true)
      : Promise.resolve({ count: 0 }),
    orgId
      ? supabase.from('invoices').select('id, status', { count: 'exact' }).eq('carrier_org_id', orgId).eq('status', 'sent')
      : Promise.resolve({ count: 0 }),
  ])

  const activeLoads = (loadsRes.data ?? []).filter(
    (l: { status: string | null }) =>
      l.status !== null && ['dispatched','picked_up','in_transit'].includes(l.status)
  ).length

  const kpis: KpiCard[] = [
    { label: t('activeLoads'),    value: activeLoads,            sub: t('totalLoads', { count: loadsRes.count ?? 0 }),   icon: 'local_shipping', color: '#f97316' },
    { label: t('trucks'),         value: trucksRes.count ?? 0,   sub: t('activeFleet'),                                  icon: 'fire_truck',     color: '#1abc9c' },
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
          <div key={kpi.label} className="bg-white/5 border border-white/8 rounded-xl p-5">
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

      <div className="bg-white/5 border border-white/8 rounded-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-white font-medium text-sm">{t('recentLoads')}</h2>
          <a href="/loads" className="text-[#f97316] text-xs hover:underline">{t('viewAll')}</a>
        </div>
        <div className="px-5 py-12 text-center">
          <span className="material-symbols-outlined text-slate-600 text-4xl">local_shipping</span>
          <p className="text-slate-500 text-sm mt-3">{t('noLoadsYet')}</p>
          <a href="/loads/new" className="inline-block mt-4 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-medium rounded-lg transition">
            {t('createFirstLoad')}
          </a>
        </div>
      </div>
    </div>
  )
}
