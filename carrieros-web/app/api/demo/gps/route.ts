import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, createAdminClient } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'
import { hasFeature } from '@/lib/entitlements'

// A dedicated Houston → Austin demo loop, deliberately separate from the
// static Dallas-area fixture positions. Only the chosen load's truck moves.
const ROUTE_ANCHORS: Array<[number, number]> = [
  [29.7604, -95.3698], [29.7858, -95.8245], [29.7808, -96.1572], [29.7066, -96.5399],
  [29.7030, -96.7800], [29.6872, -97.1081], [29.6800, -97.6470], [29.8843, -97.6700],
  [30.0852, -97.8403], [30.2672, -97.7431],
]
const OUTBOUND = ROUTE_ANCHORS.slice(0, -1).flatMap((from, index) => {
  const to = ROUTE_ANCHORS[index + 1]
  return Array.from({ length: 500 }, (_, step) => [
    from[0] + (to[0] - from[0]) * step / 500,
    from[1] + (to[1] - from[1]) * step / 500,
  ] as [number, number])
})
const ROUTE = [...OUTBOUND, ...[...OUTBOUND].reverse()]

// Demo-only synthetic feed: writes are limited to devices explicitly created
// by load-demo-data.mjs. Real vendor devices can never be moved by this route.
export async function POST(request: NextRequest) {
  const context = await getAuthedContext(request)
  if (isErrorResponse(context)) return context
  const { supabase, user } = context
  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id || !roleHasCapability(profile.role, 'dispatch')) {
    return NextResponse.json({ error: 'Dispatch access required' }, { status: 403 })
  }
  if (!(await hasFeature(supabase, 'desktop_command_center'))) {
    return NextResponse.json({ error: 'Dispatch feature unavailable' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { tick?: unknown; load_id?: unknown }
  const tick = Number.isInteger(body.tick) && Number(body.tick) >= 0 ? Number(body.tick) : 0
  const loadId = Number.isInteger(body.load_id) && Number(body.load_id) > 0 ? Number(body.load_id) : null
  if (!loadId) return NextResponse.json({ error: 'Choose one active demo load to simulate' }, { status: 400 })
  const admin = createAdminClient()
  const vehicleResult = await admin.from('vehicles').select('id')
    .eq('carrier_org_id', profile.org_id).like('telematics_device_id', 'demo-samsara-%')
  if (vehicleResult.error) return NextResponse.json({ error: 'Could not load demo fleet' }, { status: 500 })
  const vehicles = (vehicleResult.data ?? []) as Array<{ id: number }>
  const demoIds = new Set(vehicles.map((vehicle) => vehicle.id))
  const loadResult = await admin.from('loads').select('id, vehicle_id, status')
    .eq('carrier_org_id', profile.org_id).eq('id', loadId)
    .in('status', ['dispatched', 'picked_up', 'in_transit']).not('vehicle_id', 'is', null).maybeSingle()
  if (loadResult.error) return NextResponse.json({ error: 'Could not load demo shipment' }, { status: 500 })
  const load = loadResult.data as { id: number; vehicle_id: number | null; status: string | null } | null
  if (!load || load.vehicle_id == null || !demoIds.has(load.vehicle_id)) {
    return NextResponse.json({ error: 'That load is not assigned to an active demo truck' }, { status: 404 })
  }
  const { data: latestPing } = await admin.from('vehicle_locations')
    .select('recorded_at').eq('carrier_org_id', profile.org_id).eq('vehicle_id', load.vehicle_id).eq('source', 'samsara')
    .order('recorded_at', { ascending: false }).limit(1).maybeSingle()
  if (latestPing && Date.now() - new Date(latestPing.recorded_at).getTime() < 2000) {
    return NextResponse.json({ error: 'This truck was updated less than 2 seconds ago' }, { status: 429 })
  }

  if (tick % 15 === 0 && demoIds.size) {
    const cutoff = new Date(Date.now() - 2 * 60_000).toISOString()
    await admin.from('vehicle_locations').delete().eq('carrier_org_id', profile.org_id).eq('source', 'samsara')
      .in('vehicle_id', [...demoIds]).lt('recorded_at', cutoff)
  }
  const recordedAt = new Date().toISOString()
  const point = ROUTE[tick % ROUTE.length]
  const positions = [{ load, lat: point[0], lng: point[1] }]
  const { error: insertError } = await admin.from('vehicle_locations').insert(positions.map(({ load, lat, lng }) => ({
    vehicle_id: load.vehicle_id!, carrier_org_id: profile.org_id!, lat, lng, recorded_at: recordedAt, source: 'samsara' as const,
  })))
  if (insertError) return NextResponse.json({ error: 'Could not publish demo GPS positions' }, { status: 500 })

  for (const { load, lat, lng } of positions) {
    const update = await admin.from('loads').update({ last_location_lat: lat, last_location_lng: lng, last_location_at: recordedAt })
      .eq('carrier_org_id', profile.org_id).eq('id', load.id)
    if (update.error) return NextResponse.json({ error: 'Positions published but load locations did not all update' }, { status: 500 })
  }
  return NextResponse.json({ updated: positions.length, load_id: load.id, recorded_at: recordedAt })
}
