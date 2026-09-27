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
import { dedupeByVehicle, type DispatchMapPin, type DispatchMapPinSource, type DispatchMapLoad } from '@/lib/dispatch-map-pins'

// Re-exported for any other client-side caller still importing these from here (this file used to
// define them directly — moved to lib/dispatch-map-pins.ts so app/(app)/dispatch/page.tsx, a server
// component, can use dedupeByVehicle() without importing it through this 'use client' file's
// boundary: React Server Components treat every named export of a 'use client' module as client-only
// for cross-boundary calls, even a plain function with zero React/browser dependencies — this surfaced
// at request time as "Attempted to call dedupeByVehicle() from the server but dedupeByVehicle is on
// the client" (only at runtime, not at build/tsc, which is why it went unnoticed until the page was
// actually hit).
export { dedupeByVehicle, type DispatchMapPin, type DispatchMapPinSource, type DispatchMapLoad }

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
                {((p as DispatchMapPin & { shipment?: { customer: string | null; origin: string | null; destination: string | null } }).shipment) ? (
                  <>
                    <strong>Shipment</strong><br />
                    {((p as DispatchMapPin & { shipment?: { customer: string | null; origin: string | null; destination: string | null } }).shipment)?.customer ?? 'Customer not assigned'}<br />
                    {((p as DispatchMapPin & { shipment?: { customer: string | null; origin: string | null; destination: string | null } }).shipment)?.origin ?? 'Origin'} → {((p as DispatchMapPin & { shipment?: { customer: string | null; origin: string | null; destination: string | null } }).shipment)?.destination ?? 'Destination'}<br />
                  </>
                ) : p.kind === 'vehicle' ? (
                  <span style={{ color: '#64748b' }}>No active shipment</span>
                ) : null}
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
