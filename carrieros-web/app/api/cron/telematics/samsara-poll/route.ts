// POST /api/cron/telematics/samsara-poll — polls Samsara's vehicle-locations feed for every org with
// an enabled Samsara telematics_integrations row, and writes each mapped vehicle's latest fix into
// vehicle_locations. Unlike Motive, Samsara does not push continuous GPS locations via webhook
// (https://developers.samsara.com/docs/webhooks — their webhooks are alert/event-based, e.g.
// harsh-braking or geofence events, not a live position stream); real-time location for Samsara
// requires polling the REST feed documented at
// https://developers.samsara.com/reference/getvehiclelocationsfeed, which this route calls.
//
// *** VERIFICATION STATUS (be explicit, per the task): this adapter has NOT been exercised against a
// real Samsara account or API response — no Samsara account exists for this project yet (see
// docs/decisions.md). It is built strictly to the documented OpenAPI shape fetched live from
// https://developers.samsara.com/reference/getvehiclelocationsfeed at the time this was written:
//   GET https://api.samsara.com/fleet/vehicles/locations/feed
//     Headers: Authorization: Bearer <token>
//     Query:   after (opaque cursor, optional)
//     Response: { data: [ { id: string, name: string, locations: [ { latitude, longitude, heading?,
//                speed?, time: RFC3339 string } ] } ], pagination: { endCursor: string, hasNextPage: boolean } }
// `id` is Samsara's own immutable Vehicle ID (the OpenAPI schema explicitly notes "automatically
// generated ... cannot be changed") -- the same rationale as Motive's `vehicle_id` choice
// (app/api/webhooks/telematics/motive/[org_id]/route.ts), so this app registers THAT as
// vehicles.telematics_device_id for Samsara-provider vehicles, not the editable `name`.
// This is otherwise a plain, direct translation of that documented shape -- correct by inspection,
// not by a live round-trip. Wiring an external scheduler (Vercel Cron, AWS EventBridge Scheduler,
// etc.) to call this route periodically is a deployment-time decision, out of scope here — this only
// builds the callable endpoint itself, same posture as app/api/cron/send-reminders/route.ts.
//
// This route has no user session (called by an external scheduler) — protected by the same
// CRON_SECRET shared-secret convention app/api/cron/send-reminders/route.ts already establishes,
// not a new one.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { decryptSecret } from '@/lib/crypto/secrets'
import { logError } from '@/lib/observability'

const SAMSARA_API_BASE = 'https://api.samsara.com'

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const authHeader = request.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (bearer === secret) return true
  const queryToken = request.nextUrl.searchParams.get('token')
  return queryToken === secret
}

interface SamsaraLocation {
  latitude: number
  longitude: number
  time: string
}

interface SamsaraVehicleLocations {
  id: string
  name: string
  locations: SamsaraLocation[]
}

interface SamsaraLocationsFeedResponse {
  data: SamsaraVehicleLocations[]
  pagination: { endCursor: string; hasNextPage: boolean }
}

// Follows the documented `after`/`hasNextPage` cursor to collect every vehicle's latest fix in one
// poll pass -- the endpoint's own doc text ("your first call ... will provide the most recent
// location for each vehicle") implies the first page-through already covers the whole fleet, with
// pagination only needed for fleets larger than one page, not for "newer events since last call"
// (that distinction only matters once `after` is passed back in on a LATER poll, which this
// snapshot-style poller deliberately does not do -- see header comment: we want each org's current
// fleet positions every run, not an event backlog to replay).
async function fetchAllVehicleLocations(apiKey: string): Promise<SamsaraVehicleLocations[]> {
  const all: SamsaraVehicleLocations[] = []
  let after: string | undefined
  for (let page = 0; page < 20; page++) {
    const url = new URL('/fleet/vehicles/locations/feed', SAMSARA_API_BASE)
    if (after) url.searchParams.set('after', after)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (!res.ok) throw new Error(`Samsara locations feed returned HTTP ${res.status}`)
    const body = (await res.json()) as SamsaraLocationsFeedResponse
    all.push(...(body.data ?? []))
    if (!body.pagination?.hasNextPage || !body.pagination.endCursor) break
    after = body.pagination.endCursor
  }
  return all
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error_code: 'FORBIDDEN', error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: integrations, error: integrationsError } = await admin
    .from('telematics_integrations')
    .select('carrier_org_id, api_key_encrypted')
    .eq('provider', 'samsara')
    .eq('enabled', true)

  if (integrationsError) {
    logError({ route: 'cron/telematics/samsara-poll' }, integrationsError.message)
    return NextResponse.json({ error_code: 'SERVER_ERROR', error: integrationsError.message }, { status: 500 })
  }

  let orgsPolled = 0
  let locationsWritten = 0
  let orgsFailed = 0

  for (const integration of integrations ?? []) {
    if (!integration.api_key_encrypted) continue
    const orgId = integration.carrier_org_id

    try {
      const apiKey = decryptSecret(integration.api_key_encrypted)
      const vehicleLocations = await fetchAllVehicleLocations(apiKey)
      orgsPolled += 1
      if (vehicleLocations.length === 0) continue

      const { data: registeredVehicles, error: vehiclesError } = await admin
        .from('vehicles')
        .select('id, telematics_device_id')
        .eq('carrier_org_id', orgId)
        .eq('telematics_provider', 'samsara')
        .not('telematics_device_id', 'is', null)

      if (vehiclesError) {
        logError({ route: 'cron/telematics/samsara-poll' }, vehiclesError.message, { orgId, step: 'vehicle lookup' })
        orgsFailed += 1
        continue
      }

      const byDeviceId = new Map((registeredVehicles ?? []).map((v) => [v.telematics_device_id, v.id]))

      const rows = vehicleLocations
        .map((v) => {
          const vehicleId = byDeviceId.get(v.id)
          // Most recent fix for this vehicle -- the documented shape returns each vehicle's location
          // history for the polled window; index 0 is the newest per Samsara's own "most recent
          // location for each vehicle" description of the un-paginated first call.
          const latest = v.locations[0]
          if (!vehicleId || !latest) return null
          return {
            vehicle_id: vehicleId,
            carrier_org_id: orgId,
            lat: latest.latitude,
            lng: latest.longitude,
            recorded_at: latest.time,
            source: 'samsara' as const,
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

      if (rows.length === 0) continue

      const { error: insertError } = await admin.from('vehicle_locations').insert(rows)
      if (insertError) {
        logError({ route: 'cron/telematics/samsara-poll' }, insertError.message, { orgId, step: 'insert locations' })
        orgsFailed += 1
        continue
      }
      locationsWritten += rows.length
    } catch (e) {
      logError({ route: 'cron/telematics/samsara-poll' }, e, { orgId, step: 'poll' })
      orgsFailed += 1
    }
  }

  return NextResponse.json({ orgs_polled: orgsPolled, orgs_failed: orgsFailed, locations_written: locationsWritten })
}
