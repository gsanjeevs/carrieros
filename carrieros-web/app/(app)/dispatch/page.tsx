// app/(app)/dispatch/page.tsx
// Live dispatch map (audit gap #13 cluster / PRD "Desktop Command Center",
// Growth+ desktop_command_center feature — "Dispatcher desktop: all
// trucks on map + load queue + driver availability"). Plots
// loads.last_location_lat/lng (written by the mobile app's
// share-location-section.tsx) on a Leaflet/OpenStreetMap map, alongside a
// queue of loads still needing dispatch.
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import DispatchMapClient from './DispatchMapClient'
import { hasFeature } from '@/lib/entitlements'
import { loadStatusVariant, type LoadStatus } from '@/lib/domain/load-status'
import StatusBadge from '@/components/ui/StatusBadge'
import type { DispatchMapLoad } from '@/components/DispatchMap'

const VIEW_ROLES = ['owner', 'solo', 'dispatcher']

export default async function DispatchPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) redirect('/onboarding')
  if (!VIEW_ROLES.includes(profile.role)) redirect('/dashboard')

  const t = await getTranslations('dispatch')
  const tLoads = await getTranslations('loads')
  const locale = await getLocale()

  const entitled = await hasFeature(supabase, 'desktop_command_center')

  if (!entitled) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-white mb-4">{t('title')}</h1>
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center shadow-card-dark">
          <span className="material-symbols-outlined text-slate-600 text-4xl">map</span>
          <p className="text-slate-400 text-sm mt-3">{t('upgradeRequired')}</p>
        </div>
      </div>
    )
  }

  const { data: activeLoadsData } = await supabase
    .from('loads')
    .select('id, load_number, status, last_location_lat, last_location_lng, last_location_at, drivers(profiles(first_name, last_name))')
    .eq('carrier_org_id', profile.org_id)
    .in('status', ['dispatched', 'picked_up', 'in_transit'])
    .not('last_location_lat', 'is', null)
    .not('last_location_lng', 'is', null)

  const mapLoads: DispatchMapLoad[] = (activeLoadsData ?? []).map((l) => ({
    id: l.id,
    loadNumber: l.load_number,
    status: l.status ?? 'dispatched',
    driverName: l.drivers?.profiles
      ? [l.drivers.profiles.first_name, l.drivers.profiles.last_name].filter(Boolean).join(' ') || null
      : null,
    lat: Number(l.last_location_lat),
    lng: Number(l.last_location_lng),
    lastLocationAt: l.last_location_at as string,
  }))

  const { data: queueData } = await supabase
    .from('loads')
    .select('id, load_number, status, pickup_city, pickup_state, customer_name_raw')
    .eq('carrier_org_id', profile.org_id)
    .in('status', ['draft', 'scheduled'])
    .order('created_at', { ascending: false })
    .limit(20)

  const queue = queueData ?? []

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
        <p className="text-slate-400 text-sm mt-1">{t('subtitle', { count: mapLoads.length })}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DispatchMapClient loads={mapLoads} locale={locale} />
          {mapLoads.length === 0 && (
            <p className="text-slate-500 text-xs mt-2">{t('noActiveLocations')}</p>
          )}
        </div>

        <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark self-start">
          <div className="px-5 py-3.5 border-b border-white/5">
            <h2 className="text-white font-medium text-sm">{t('queueTitle')}</h2>
          </div>
          {queue.length === 0 ? (
            <div className="px-5 py-4 text-slate-500 text-sm">{t('noQueue')}</div>
          ) : (
            <div className="divide-y divide-white/5">
              {queue.map((l) => (
                <Link
                  key={l.id}
                  href={`/loads/${l.load_number}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.07] transition-colors duration-150"
                >
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{l.load_number}</p>
                    <p className="text-slate-500 text-xs truncate">{l.customer_name_raw ?? '—'}</p>
                  </div>
                  <StatusBadge variant={loadStatusVariant((l.status ?? 'draft') as LoadStatus)} size="sm">
                    {tLoads(`status_${l.status ?? 'draft'}` as never)}
                  </StatusBadge>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
