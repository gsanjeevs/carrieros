// app/(app)/dispatch/page.tsx
// Live dispatch map (audit gap #13 cluster / PRD "Desktop Command Center",
// Growth+ desktop_command_center feature — "Dispatcher desktop: all
// trucks on map + load queue + driver availability"). Plots two location
// sources, normalized into DispatchMapPin (components/DispatchMap.tsx):
//   - loads.last_location_lat/lng (phone GPS, share-location-section.tsx),
//     only while a load has an active status.
//   - vehicle_locations (real telematics, migration 0042 — Motive webhook
//     receiver / Samsara poller), independent of any load. This is what lets
//     an IDLE truck with no active load still show up on the map.
// A vehicle reporting through both sources shows one pin, whichever reading
// is more recent (dedupeByVehicle() in components/DispatchMap.tsx) — not a
// hardcoded "always prefer telematics", since a fresher phone ping should
// win over a stale telematics fix and vice versa.
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import DispatchMapClient from './DispatchMapClient'
import DispatchQueueRow from './DispatchQueueRow'
import { hasFeature } from '@/lib/entitlements'
import { Card, CardHeader, EmptyState } from '@/components/ui'
import { dedupeByVehicle, type DispatchMapPin } from '@/components/DispatchMap'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

export default async function DispatchPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) redirect('/onboarding')
  if (!roleHasCapability(profile.role, 'dispatch')) redirect('/dashboard')

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
    .select('id, load_number, status, vehicle_id, last_location_lat, last_location_lng, last_location_at, pickup_city, pickup_state, delivery_city, delivery_state, customer_name_raw, drivers(profiles(first_name, last_name))')
    .eq('carrier_org_id', profile.org_id)
    .in('status', ['dispatched', 'picked_up', 'in_transit'])
    .not('last_location_lat', 'is', null)
    .not('last_location_lng', 'is', null)

  const loadPins: DispatchMapPin[] = (activeLoadsData ?? []).map((l) => ({
    id: `load-${l.id}`,
    kind: 'load',
    vehicleId: l.vehicle_id,
    label: l.load_number,
    status: l.status ?? 'dispatched',
    driverName: l.drivers?.profiles
      ? [l.drivers.profiles.first_name, l.drivers.profiles.last_name].filter(Boolean).join(' ') || null
      : null,
    lat: Number(l.last_location_lat),
    lng: Number(l.last_location_lng),
    lastLocationAt: l.last_location_at as string,
    source: 'phone',
    shipment: {
      customer: l.customer_name_raw,
      origin: [l.pickup_city, l.pickup_state].filter(Boolean).join(', ') || null,
      destination: [l.delivery_city, l.delivery_state].filter(Boolean).join(', ') || null,
    },
  }))
  const activeLoadByVehicle = new Map(
    (activeLoadsData ?? [])
      .filter((load) => load.vehicle_id != null)
      .map((load) => [load.vehicle_id as number, load])
  )

  // Idle-truck telematics (migration 0042): every vehicle with a registered device that has EVER
  // reported a position, regardless of whether it currently has an active load. Latest fix per
  // vehicle is picked in JS below rather than with a DB-side DISTINCT ON, since supabase-js has no
  // first-class way to express that and the fleet-size row count here is small enough it doesn't
  // matter (same tradeoff the rest of this page already makes with plain .select() calls).
  const { data: telematicsVehicles } = await supabase
    .from('vehicles')
    .select('id, nickname, vehicle_number, status')
    .eq('carrier_org_id', profile.org_id)
    .not('telematics_device_id', 'is', null)

  const telematicsVehicleIds = (telematicsVehicles ?? []).map((v) => v.id)

  const { data: recentLocations } = telematicsVehicleIds.length
    ? await supabase
        .from('vehicle_locations')
        .select('vehicle_id, lat, lng, recorded_at, source')
        .eq('carrier_org_id', profile.org_id)
        .in('vehicle_id', telematicsVehicleIds)
        .order('recorded_at', { ascending: false })
        .limit(500)
    : { data: [] }

  const latestByVehicle = new Map<number, { lat: number; lng: number; recorded_at: string; source: string }>()
  for (const loc of recentLocations ?? []) {
    if (!latestByVehicle.has(loc.vehicle_id)) latestByVehicle.set(loc.vehicle_id, loc)
  }

  const vehiclePins: DispatchMapPin[] = (telematicsVehicles ?? [])
    .map((v): DispatchMapPin | null => {
      const loc = latestByVehicle.get(v.id)
      if (!loc) return null
      const shipment = activeLoadByVehicle.get(v.id)
      return {
        id: `vehicle-${v.id}`,
        kind: 'vehicle',
        vehicleId: v.id,
        label: v.nickname || v.vehicle_number || `#${v.id}`,
        status: v.status ?? 'active',
        driverName: null,
        lat: Number(loc.lat),
        lng: Number(loc.lng),
        lastLocationAt: loc.recorded_at,
        source: loc.source === 'samsara' || loc.source === 'motive' ? loc.source : 'phone',
        shipment: shipment ? {
          customer: shipment.customer_name_raw,
          origin: [shipment.pickup_city, shipment.pickup_state].filter(Boolean).join(', ') || null,
          destination: [shipment.delivery_city, shipment.delivery_state].filter(Boolean).join(', ') || null,
        } : undefined,
      }
    })
    .filter((p): p is DispatchMapPin => p !== null)

  const mapPins = dedupeByVehicle([...loadPins, ...vehiclePins])

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
        <p className="text-text-sec text-sm mt-1">{t('subtitle', { count: mapPins.length })}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DispatchMapClient pins={mapPins} locale={locale} orgId={profile.org_id} />
          {mapPins.length === 0 && (
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
