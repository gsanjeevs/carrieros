// app/(app)/dispatch/page.tsx
// Live dispatch map (audit gap #13 cluster / PRD "Desktop Command Center",
// Growth+ desktop_command_center feature — "Dispatcher desktop: all
// trucks on map + load queue + driver availability"). Plots
// loads.last_location_lat/lng (written by the mobile app's
// share-location-section.tsx) on a Leaflet/OpenStreetMap map, alongside a
// queue of loads still needing dispatch.
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import DispatchMapClient from './DispatchMapClient'
import DispatchQueueRow from './DispatchQueueRow'
import { hasFeature } from '@/lib/entitlements'
import { Card, CardHeader, EmptyState } from '@/components/ui'
import type { DispatchMapLoad } from '@/components/DispatchMap'
import { getProfileForUser } from '@/lib/queries/profiles'

const VIEW_ROLES = ['owner', 'solo', 'dispatcher']

export default async function DispatchPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) redirect('/onboarding')
  if (!VIEW_ROLES.includes(profile.role)) redirect('/dashboard')

  const t = await getTranslations('dispatch')
  const locale = await getLocale()

  const entitled = await hasFeature(supabase, 'desktop_command_center')

  if (!entitled) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-text-pri mb-4">{t('title')}</h1>
        <Card>
          <EmptyState icon="map" title={t('upgradeRequired')} />
        </Card>
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
    .select('id, load_number, status, pickup_city, pickup_state, customer_name_raw, driver_id, vehicle_id')
    .eq('carrier_org_id', profile.org_id)
    .in('status', ['draft', 'scheduled'])
    .order('created_at', { ascending: false })
    .limit(20)

  const queue = queueData ?? []

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
        <p className="text-text-sec text-sm mt-1">{t('subtitle', { count: mapLoads.length })}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DispatchMapClient loads={mapLoads} locale={locale} />
          {mapLoads.length === 0 && (
            <p className="text-text-mut text-xs mt-2">{t('noActiveLocations')}</p>
          )}
        </div>

        <Card className="self-start">
          <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('queueTitle')}</h2></CardHeader>
          {queue.length === 0 ? (
            <div className="px-5 py-4 text-text-sec text-sm">{t('noQueue')}</div>
          ) : (
            <div className="divide-y divide-divider-ui">
              {queue.map((l) => (
                <DispatchQueueRow
                  key={l.id}
                  loadId={l.id}
                  loadNumber={l.load_number}
                  status={l.status ?? 'draft'}
                  customerName={l.customer_name_raw}
                  driverId={l.driver_id}
                  vehicleId={l.vehicle_id}
                  orgId={profile.org_id}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
