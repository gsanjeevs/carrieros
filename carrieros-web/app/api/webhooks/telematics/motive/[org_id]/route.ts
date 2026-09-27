// POST /api/webhooks/telematics/motive/{org_id} — real-time Motive (Gomotive) vehicle-location
// webhook receiver. Vendor-called, NOT a session-authenticated /api/v1 route (Motive has no user
// session, no cookie, no bearer token of ours) — deliberately outside app/api/v1 for that reason,
// same rationale app/api/cron/* routes already establish for "called by something other than a
// logged-in browser".
//
// Motive's documented contract (https://developer-docs.gomotive.com/reference/webhooks-v2):
//   - Event types `vehicle_location_updated` (newer than the vehicle's last known location) and
//     `vehicle_location_received` (every location received, including older/out-of-order ones) —
//     both carry the same payload shape (vehicle_id, vehicle_number, located_at, lat, lon, ...), so
//     this receiver treats them identically: any inbound fix is written to vehicle_locations, and
//     staleness/precedence is a read-time concern (app/(app)/dispatch/page.tsx), not a write-time
//     filter here. There is no reason to reject an "out of order" fix outright — it is still a real
//     historical position, and vehicle_locations already carries the vendor's own `recorded_at`, so
//     an older fix arriving late cannot corrupt what the map shows right now.
//   - Signature: HMAC-SHA1 hex digest of the RAW received JSON payload (not the re-serialized/parsed
//     body — whitespace/key-order differences would break the digest) using the integration's shared
//     secret, compared against the `X-KT-Webhook-Signature` header. Mismatch -> 403.
//   - Respond within 3 seconds: signature verification happens FIRST and is the only required work
//     before responding; the DB writes below are simple indexed lookups/inserts, not slow work that
//     needs to be deferred to a queue.
//
// Device-id choice: this app registers Motive's `vehicle_id` (not `vehicle_number`) as
// vehicles.telematics_device_id. `vehicle_id` is Motive's own immutable internal identifier;
// `vehicle_number` is a user-editable label in Motive's own fleet UI (the direct analog of this
// app's own vehicles.vehicle_number, which is similarly editable) — matching on the editable label
// would silently break the mapping the moment someone renames a vehicle in Motive.
import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { decryptSecret } from '@/lib/crypto/secrets'
import { logError } from '@/lib/observability'

interface MotiveLocationPayload {
  action?: string
  trigger?: string
  id?: number
  vehicle_id: number | string
  vehicle_number?: string
  located_at: string
  lat: number
  lon: number
}

function verifySignature(rawBody: string, secret: string, headerSignature: string | null): boolean {
  if (!headerSignature) return false
  const expected = createHmac('sha1', secret).update(rawBody, 'utf8').digest('hex')
  const expectedBuf = Buffer.from(expected, 'utf8')
  const actualBuf = Buffer.from(headerSignature, 'utf8')
  // timingSafeEqual throws on length mismatch rather than returning false -- guard explicitly so a
  // malformed/short header can't crash the request into an unhandled 500 (and can't short-circuit
  // into a length-based timing side channel either).
  if (expectedBuf.length !== actualBuf.length) return false
  return timingSafeEqual(expectedBuf, actualBuf)
}

export async function POST(request: NextRequest, context: { params: Promise<{ org_id: string }> }) {
  const orgId = Number((await context.params).org_id)
  if (!Number.isInteger(orgId) || orgId <= 0) {
    return NextResponse.json({ error: 'Invalid org_id' }, { status: 404 })
  }

  // Raw text FIRST -- signature verification is over the exact bytes received, not a re-serialized
  // JSON.parse() round-trip (which can reorder keys/change whitespace and silently break the HMAC).
  const rawBody = await request.text()
  const headerSignature = request.headers.get('x-kt-webhook-signature')

  const admin = createAdminClient()

  const { data: integration, error: integrationError } = await admin
    .from('telematics_integrations')
    .select('webhook_secret_encrypted, enabled')
    .eq('carrier_org_id', orgId)
    .eq('provider', 'motive')
    .maybeSingle()

  if (integrationError) {
    logError({ route: 'webhooks/telematics/motive' }, integrationError.message, { orgId })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
  if (!integration || !integration.enabled || !integration.webhook_secret_encrypted) {
    // No configured (or disabled) Motive integration for this org -- there is no secret to verify
    // against, so this can never be a legitimate signed call. 404 rather than 403: distinguishes
    // "this org never set this up" from "this org set it up and the signature was wrong."
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let secret: string
  try {
    secret = decryptSecret(integration.webhook_secret_encrypted)
  } catch (e) {
    logError({ route: 'webhooks/telematics/motive' }, e, { orgId, step: 'decrypt webhook secret' })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }

  if (!verifySignature(rawBody, secret, headerSignature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  let payload: MotiveLocationPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (payload.vehicle_id == null || payload.lat == null || payload.lon == null || !payload.located_at) {
    // Acknowledge (200) rather than reject -- an unrecognized/partial payload shape from a verified,
    // trusted sender is a "nothing to do" case, not a delivery failure Motive should retry forever.
    return NextResponse.json({ ok: true, skipped: 'missing required fields' })
  }

  const { data: vehicle, error: vehicleError } = await admin
    .from('vehicles')
    .select('id')
    .eq('carrier_org_id', orgId)
    .eq('telematics_provider', 'motive')
    .eq('telematics_device_id', String(payload.vehicle_id))
    .maybeSingle()

  if (vehicleError) {
    logError({ route: 'webhooks/telematics/motive' }, vehicleError.message, { orgId, step: 'vehicle lookup' })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
  if (!vehicle) {
    // Verified, well-formed event for a vehicle this org hasn't registered (or registered under a
    // different device id) -- still 200: it is not this request's fault, and Motive should not keep
    // retrying a delivery this app will never be able to use.
    return NextResponse.json({ ok: true, skipped: 'vehicle not registered for this device id' })
  }

  const { error: insertError } = await admin.from('vehicle_locations').insert({
    vehicle_id: vehicle.id,
    carrier_org_id: orgId,
    lat: payload.lat,
    lng: payload.lon,
    recorded_at: payload.located_at,
    source: 'motive',
  })

  if (insertError) {
    logError({ route: 'webhooks/telematics/motive' }, insertError.message, { orgId, vehicleId: vehicle.id, step: 'insert location' })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
