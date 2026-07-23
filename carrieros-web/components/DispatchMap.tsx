'use client'
// components/DispatchMap.tsx
// Live dispatch map (audit gap #13 cluster / PRD "Desktop Command Center",
// Growth+ desktop_command_center feature: "Dispatcher desktop: all trucks
// on map + load queue + driver availability"). Uses Leaflet + OpenStreetMap
// tiles — no API key, no paid mapping service — plotting the same
// loads.last_location_lat/lng/last_location_at columns
// share-location-section.tsx (mobile) already writes to and the public
// tracking page already reads.
//
// Client-only: Leaflet touches `window` at import time, so this component
// is always loaded via next/dynamic with ssr:false (see DispatchMap's own
// page.tsx call site).
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

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

export interface DispatchMapLoad {
  id: number
  loadNumber: string
  status: string
  driverName: string | null
  lat: number
  lng: number
  lastLocationAt: string
}

const US_CENTER: [number, number] = [39.8283, -98.5795]

export default function DispatchMap({ loads, locale }: { loads: DispatchMapLoad[]; locale: string }) {
  const center: [number, number] =
    loads.length > 0
      ? [loads.reduce((s, l) => s + l.lat, 0) / loads.length, loads.reduce((s, l) => s + l.lng, 0) / loads.length]
      : US_CENTER

  return (
    <MapContainer
      center={center}
      zoom={loads.length > 0 ? 6 : 4}
      style={{ height: '480px', width: '100%', borderRadius: '12px' }}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {loads.map((l) => (
        <Marker key={l.id} position={[l.lat, l.lng]} icon={DEFAULT_ICON}>
          <Popup>
            <div style={{ fontSize: '13px' }}>
              <strong>{l.loadNumber}</strong>
              <br />
              {l.driverName ?? '—'}
              <br />
              {new Date(l.lastLocationAt).toLocaleString(locale)}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
