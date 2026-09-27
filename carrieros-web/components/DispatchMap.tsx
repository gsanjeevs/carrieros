'use client'
// components/DispatchMap.tsx
// Live dispatch map (audit gap #13 cluster / PRD "Desktop Command Center",
// Growth+ desktop_command_center feature: "Dispatcher desktop: all trucks
// on map + load queue + driver availability"). Uses Leaflet + OpenStreetMap
// tiles — no API key, no paid mapping service.
//
// Two location sources feed this map, normalized into one DispatchMapPin
// shape (renamed from DispatchMapLoad, 2026-09-26 telematics integration —
// see server/domain/telematics/model.ts and migration 0042): a load's
// phone-GPS position (loads.last_location_lat/lng/last_location_at, written
// by share-location-section.tsx, only exists while the load has an active
// status) and a vehicle's telematics position (vehicle_locations, written by
// the Motive webhook receiver / Samsara poller, exists independent of any
// load — this is what lets an IDLE truck with no active load still show up).
// A vehicle with both sources reporting shows only ONE pin, whichever
// reading is more recent — see dedupeByVehicle() below, shared between the
// server's initial query (app/(app)/dispatch/page.tsx) and the client's
// realtime merge (DispatchMapClient.tsx) so the same precedence rule applies
// both at first paint and as new events arrive.
//
// Client-only: Leaflet touches `window` at import time, so this component
// is always loaded via next/dynamic with ssr:false (see DispatchMap's own
// page.tsx call site).
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import { useTranslations } from 'next-intl'
import 'leaflet/dist/leaflet.css'

// No fixed GPS ping interval exists today (share-location-section.tsx samples
// on 50m of movement, not a timer, and the Samsara poller's own cadence
// depends on whatever external scheduler ends up calling it), so this is a
// judgment threshold, not a hard SLA: a pin older than this is shown faded
// with a stale badge rather than looking identical to a fresh one.
const STALE_THRESHOLD_MS = 15 * 60 * 1000

// Leaflet's default marker icon references image paths that don't survive
// a webpack bundle. CDN-hosted icons sidestep needing new webpack asset
// rules just for this one component.
const DEFAULT_ICON = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

export type DispatchMapPinSource = 'phone' | 'samsara' | 'motive'

export interface DispatchMapPin {
  /** Stable React/Leaflet key, unique across BOTH kinds — `load-<load id>` or `vehicle-<vehicle id>`. */
  id: string
  kind: 'load' | 'vehicle'
  /** Null only in the (currently never-hit) case a load has no vehicle assigned yet but somehow has a
   * phone location — kept nullable rather than widened to 0, since dedupeByVehicle must never treat
   * two genuinely-unrelated "no vehicle" pins as the same vehicle. */
  vehicleId: number | null
  /** Load number for a `load` pin, vehicle nickname/number for a `vehicle` pin. */
  label: string
  status: string
  driverName: string | null
  lat: number
  lng: number
  lastLocationAt: string
  source: DispatchMapPinSource
}

/** @deprecated renamed to DispatchMapPin — kept as an alias so any straggling import doesn't need to
 * change in the same commit as its call site; remove once nothing references it. */
export type DispatchMapLoad = DispatchMapPin

// Precedence rule (task requirement — "don't just hardcode always prefer telematics"): when the same
// vehicle has both a load-derived pin (phone GPS) and a vehicle-derived pin (telematics), keep
// whichever has the MORE RECENT lastLocationAt, not a fixed source priority. Telematics is generally
// the more reliable/higher-frequency source when present, but a phone ping from 30 seconds ago is
// still more current than a telematics fix from 10 minutes ago, and showing the stale one as if it
// were live would be a worse outcome than the two-pins-for-one-truck problem this function exists to
// avoid. Pins with vehicleId === null (should not occur in practice) always pass through unmerged.
export function dedupeByVehicle(pins: readonly DispatchMapPin[]): DispatchMapPin[] {
  const byVehicle = new Map<number, DispatchMapPin>()
  const unassigned: DispatchMapPin[] = []
  for (const pin of pins) {
    if (pin.vehicleId == null) {
      unassigned.push(pin)
      continue
    }
    const existing = byVehicle.get(pin.vehicleId)
    if (!existing || new Date(pin.lastLocationAt).getTime() > new Date(existing.lastLocationAt).getTime()) {
      byVehicle.set(pin.vehicleId, pin)
    }
  }
  return [...byVehicle.values(), ...unassigned]
}

const US_CENTER: [number, number] = [39.8283, -98.5795]

export default function DispatchMap({ pins, locale, now }: { pins: DispatchMapPin[]; locale: string; now: number }) {
  const t = useTranslations('dispatch')
  const center: [number, number] =
    pins.length > 0
      ? [pins.reduce((s, p) => s + p.lat, 0) / pins.length, pins.reduce((s, p) => s + p.lng, 0) / pins.length]
      : US_CENTER

  return (
    <MapContainer
      center={center}
      zoom={pins.length > 0 ? 6 : 4}
      style={{ height: '480px', width: '100%', borderRadius: '12px' }}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {pins.map((p) => {
        const isStale = now - new Date(p.lastLocationAt).getTime() > STALE_THRESHOLD_MS
        return (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={DEFAULT_ICON} opacity={isStale ? 0.45 : 1}>
            <Popup>
              <div style={{ fontSize: '13px' }}>
                <strong>{p.label}</strong>
                {p.kind === 'vehicle' && (
                  <>
                    {' '}
                    <span style={{ color: '#64748b' }}>({t('idleVehicleBadge')})</span>
                  </>
                )}
                <br />
                {p.driverName ?? '—'}
                <br />
                {new Date(p.lastLocationAt).toLocaleString(locale)}
                <br />
                <span style={{ color: isStale ? '#b45309' : '#16a34a', fontWeight: 600 }}>
                  {isStale ? t('locationStale') : t('locationLive')}
                </span>
              </div>
            </Popup>
          </Marker>
        )
      })}
    </MapContainer>
  )
}
