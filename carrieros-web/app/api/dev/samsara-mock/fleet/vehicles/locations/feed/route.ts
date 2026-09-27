// GET /api/dev/samsara-mock/fleet/vehicles/locations/feed — a local stand-in for Samsara's real
// vehicle-locations-feed endpoint (https://developers.samsara.com/reference/getvehiclelocationsfeed),
// for demoing/exercising app/api/cron/telematics/samsara-poll's real adapter code end-to-end without
// a real Samsara account (see docs/decisions.md: neither vendor is signed up for yet). Point the
// poller at this by setting SAMSARA_API_BASE_URL=http://localhost:<port>/api/dev/samsara-mock in
// .env.local (dev/demo only — never set in a real deployment) and restarting the dev server.
//
// Returns the EXACT documented response shape (same interfaces the real poller already parses),
// with two simulated trucks continuously driving Dallas -> Corsicana -> Huntsville -> Houston and
// back, so a fresh poll a few seconds apart shows real, visible movement on the live dispatch map --
// this is what makes the demo convincing: it exercises fetchAllVehicleLocations()'s real HTTP call,
// JSON parsing, and pagination-shaped response, not a bypass that skips the adapter code.
//
// Deliberately stateless: position is computed from Date.now() alone (no DB row, no server memory),
// so restarting the dev server or running multiple instances never desyncs the simulated route --
// the same instant in time always produces the same position.
import { NextRequest, NextResponse } from 'next/server'

// A gentle Dallas -> Houston bend (matches this repo's own demo-data lanes) rather than a straight
// line -- purely cosmetic, makes the movement look like a real route on the map instead of a ruler-
// straight teleport.
const ROUTE: readonly [number, number][] = [
  [32.7767, -96.797], // Dallas, TX
  [32.0954, -96.4689], // Corsicana, TX
  [30.7235, -95.5508], // Huntsville, TX
  [29.7604, -95.3698], // Houston, TX
]

const TRIP_DURATION_MS = 10 * 60 * 1000 // one Dallas<->Houston leg takes 10 simulated minutes

function positionAt(fractionOfRoute: number): { lat: number; lng: number } {
  // fractionOfRoute in [0, 1) walks the waypoint list once; the caller folds a full there-and-back
  // loop into this by mirroring the fraction for the return leg.
  const segments = ROUTE.length - 1
  const scaled = fractionOfRoute * segments
  const index = Math.min(Math.floor(scaled), segments - 1)
  const withinSegment = scaled - index
  const [lat1, lng1] = ROUTE[index]
  const [lat2, lng2] = ROUTE[index + 1]
  return {
    lat: lat1 + (lat2 - lat1) * withinSegment,
    lng: lng1 + (lng2 - lng1) * withinSegment,
  }
}

// Two trucks, offset so they're never at the exact same spot, each driving a continuous
// there-and-back loop (0 -> 1 -> 0 -> 1 ...) so the demo never "arrives and stops."
const DEMO_VEHICLES = [
  { id: 'demo-samsara-truck-1', name: 'Samsara Demo Truck 1', phaseOffsetMs: 0 },
  { id: 'demo-samsara-truck-2', name: 'Samsara Demo Truck 2', phaseOffsetMs: TRIP_DURATION_MS / 2 },
] as const

function simulatedLocation(phaseOffsetMs: number, now: number): { latitude: number; longitude: number; time: string } {
  const elapsed = (now + phaseOffsetMs) % (TRIP_DURATION_MS * 2)
  const goingForward = elapsed < TRIP_DURATION_MS
  const legElapsed = goingForward ? elapsed : elapsed - TRIP_DURATION_MS
  const fraction = legElapsed / TRIP_DURATION_MS
  const pos = positionAt(goingForward ? fraction : 1 - fraction)
  return { latitude: pos.lat, longitude: pos.lng, time: new Date(now).toISOString() }
}

export async function GET(request: NextRequest) {
  // Loosely mirrors real Samsara auth (Bearer token) so this can't be silently hit by a stray,
  // unconfigured client -- any non-empty token works, since this is a local demo double, not a
  // security boundary of its own.
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ') || auth.slice(7).length === 0) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  }

  const now = Date.now()
  const data = DEMO_VEHICLES.map((v) => ({
    id: v.id,
    name: v.name,
    locations: [simulatedLocation(v.phaseOffsetMs, now)],
  }))

  // Single page every time -- real fleets need the documented `after`/`hasNextPage` cursor, but two
  // demo vehicles never span a second page, so this deliberately never sets hasNextPage: true (the
  // real poller's pagination loop is still exercised code, it just never actually loops here).
  return NextResponse.json({ data, pagination: { endCursor: '', hasNextPage: false } })
}
