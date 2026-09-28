// app/(app)/dispatch/page.tsx
// Live dispatch map (audit gap #13 cluster / PRD "Desktop Command Center",
// Growth+ desktop_command_center feature — "Dispatcher desktop: all
// trucks on map + load queue + driver availability"). Plots two location
// sources, normalized into DispatchMapPin (lib/dispatch-map-pins.ts):
//   - loads.last_location_lat/lng (phone GPS, share-location-section.tsx),
//     only while a load has an active status.
//   - vehicle_locations (real telematics, migration 0042 — Motive webhook
//     receiver / Samsara poller), independent of any load. This is what lets
//     an IDLE truck with no active load still show up on the map.
// A vehicle reporting through both sources shows one pin, whichever reading
// is more recent (dedupeByVehicle() in lib/dispatch-map-pins.ts) — not a
// hardcoded "always prefer telematics", since a fresher phone ping should
// win over a stale telematics fix and vice versa.
//
// dedupeByVehicle/DispatchMapPin import from lib/dispatch-map-pins.ts, NOT
// components/DispatchMap.tsx (a 'use client' file — Leaflet touches `window`
// at import time): every named export of a 'use client' module is
// client-only for cross-boundary calls, even a plain non-React function, so
// this server component calling dedupeByVehicle() through DispatchMap.tsx
// threw "Attempted to call dedupeByVehicle() from the server but
// dedupeByVehicle is on the client" at request time (only surfaces at
// runtime, not at build/tsc).
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import DispatchMapClient from './DispatchMapClient'
import DispatchQueueRow from './DispatchQueueRow'
import DemoGpsControl from './DemoGpsControl'
import { hasFeature } from '@/lib/entitlements'
import { Card, CardHeader, EmptyState } from '@/components/ui'
import { dedupeByVehicle, estimateMovement, type DispatchMapPin } from '@/lib/dispatch-map-pins'
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
    onActiveLoad: true,
    movement: 'unknown',
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
    .select('id, nickname, vehicle_number, status, telematics_provider, telematics_device_id')
    .eq('carrier_org_id', profile.org_id)
    .not('telematics_device_id', 'is', null)

  const telematicsVehicleIds = (telematicsVehicles ?? []).map((v) => v.id)
  // Must match app/api/demo/gps/route.ts's own filter exactly (telematics_device_id LIKE
  // 'demo-samsara-%', the naming convention load-demo-data.mjs seeds with) -- NOT just
  // telematics_provider === 'samsara'. A real customer with a genuine Samsara integration also has
  // provider === 'samsara', so that broader check showed every real customer's real trucks in this
  // internal demo-only control, which is confusing at best (a "Start demo GPS" button they have no
  // reason to understand) and always failed anyway once clicked (the route's own device-id filter
  // rejects anything that isn't an actual demo-seeded device) -- found during a UX cleanup pass,
  // 2026-09-27.
  const demoVehicleIds = new Set((telematicsVehicles ?? [])
    .filter((vehicle) => vehicle.telematics_device_id?.startsWith('demo-samsara-'))
    .map((vehicle) => vehicle.id))

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
  const samplesByVehicle = new Map<number, Array<{ lat: number; lng: number; recorded_at: string }>>()
  for (const loc of recentLocations ?? []) {
    if (!latestByVehicle.has(loc.vehicle_id)) latestByVehicle.set(loc.vehicle_id, loc)
    const samples = samplesByVehicle.get(loc.vehicle_id) ?? []
    if (samples.length < 2) samples.push({ lat: Number(loc.lat), lng: Number(loc.lng), recorded_at: loc.recorded_at })
    samplesByVehicle.set(loc.vehicle_id, samples)
  }
  const movementByVehicle = new Map([...samplesByVehicle].map(([vehicleId, samples]) => [
    vehicleId,
    estimateMovement(
      samples[1] ? { lat: samples[1].lat, lng: samples[1].lng, lastLocationAt: samples[1].recorded_at } : null,
      { lat: samples[0].lat, lng: samples[0].lng, lastLocationAt: samples[0].recorded_at },
    ),
  ]))

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
        onActiveLoad: Boolean(shipment),
        movement: movementByVehicle.get(v.id) ?? 'unknown',
        shipment: shipment ? {
          customer: shipment.customer_name_raw,
          origin: [shipment.pickup_city, shipment.pickup_state].filter(Boolean).join(', ') || null,
          destination: [shipment.delivery_city, shipment.delivery_state].filter(Boolean).join(', ') || null,
        } : undefined,
      }
    })
    .filter((p): p is DispatchMapPin => p !== null)

  const mapPins = dedupeByVehicle([
    ...loadPins.map((pin) => ({ ...pin, movement: pin.vehicleId == null ? 'unknown' as const : movementByVehicle.get(pin.vehicleId) ?? 'unknown' as const })),
    ...vehiclePins,
  ])

  const { data: queueData } = await supabase
    .from('loads')
    .select('id, load_number, status, pickup_city, pickup_state, customer_name_raw, driver_id, vehicle_id')
    .eq('carrier_org_id', profile.org_id)
    .in('status', ['draft', 'scheduled'])
    .order('created_at', { ascending: false })
    .limit(20)

  const queue = queueData ?? []
  const demoLoads = (activeLoadsData ?? [])
    .filter((load) => load.vehicle_id != null && demoVehicleIds.has(load.vehicle_id))
    .map((load) => ({
      id: load.id,
      loadNumber: load.load_number,
      customer: load.customer_name_raw,
      destination: [load.delivery_city, load.delivery_state].filter(Boolean).join(', ') || null,
    }))

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
        <p className="text-text-sec text-sm mt-1">{t('subtitle', { count: mapPins.length })}</p>
        {/* Internal demo/sales-tooling only -- rendered only when this org actually has a
            demo-seeded Samsara vehicle (demoVehicleIds above), never for a real customer's real
            telematics integration. Previously rendered unconditionally for every org. */}
        {demoVehicleIds.size > 0 && (
          <div className="mt-4"><DemoGpsControl loads={demoLoads} /></div>
        )}
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
