// lib/dispatch-map-pins.ts
// DispatchMapPin/dedupeByVehicle, split out of components/DispatchMap.tsx (a 'use client' file --
// Leaflet touches `window` at import time) so a server component can use this pure, non-React data
// logic without importing it through the client boundary. React Server Components treat every named
// export of a 'use client' module as client-only for cross-boundary calls, even a plain function with
// zero React/browser dependencies -- app/(app)/dispatch/page.tsx (server) calling dedupeByVehicle()
// straight from components/DispatchMap.tsx threw "Attempted to call dedupeByVehicle() from the server
// but dedupeByVehicle is on the client" at request time (only surfaces at runtime, not at build/tsc,
// which is why it went unnoticed until the page was actually hit).
//
// Both the server's initial query (page.tsx) and the client's realtime merge (DispatchMapClient.tsx)
// import from here directly; components/DispatchMap.tsx re-exports these for any other client-side
// caller that still imports them from there.
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
  shipment?: {
    customer: string | null
    origin: string | null
    destination: string | null
  }
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
