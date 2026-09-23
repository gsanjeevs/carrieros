// app/api/vehicles/route.ts
import { generateVehicleNumber } from '@/lib/generate-number'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

export async function GET(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) return NextResponse.json([])

  const { data } = await supabase
    .from('vehicles')
    .select('id, vehicle_number, nickname, year, make, model, license_plate, license_state, is_active')
    .eq('carrier_org_id', profile.org_id)
    .eq('is_active', true)
    .order('vehicle_number')

  // Rule C (docs/architecture-principles.md) — explicit DTO construction,
  // even though this is a 1:1 field mapping today: a future column
  // add/rename to `vehicles` changes only this line, not every consumer.
  const vehicles = (data ?? []).map((v) => ({
    id: v.id,
    vehicle_number: v.vehicle_number,
    nickname: v.nickname,
    year: v.year,
    make: v.make,
    model: v.model,
    license_plate: v.license_plate,
    license_state: v.license_state,
    is_active: v.is_active,
  }))

  return NextResponse.json(vehicles)
}

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id)
    return apiError('NOT_ONBOARDED', 'No company', 400)

  if (!roleHasCapability(profile.role, 'vehicles_manage'))
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  const body = await request.json()

  // Validate BEFORE burning a sequence number (the same bug class already
  // fixed once in app/api/loads/route.ts — don't repeat it here).
  if (!body.nickname || !body.vehicle_type_id)
    return apiError('VALIDATION_ERROR', 'nickname and vehicle_type_id are required', 400)

  const vehicle_number = await generateVehicleNumber(supabase, profile.org_id)

  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      carrier_org_id:   profile.org_id,
      vehicle_number,
      vehicle_type_id: body.vehicle_type_id,
      nickname:      body.nickname,
      year:          body.year          ?? null,
      make:          body.make          ?? null,
      model:         body.model         ?? null,
      vin:           body.vin           ?? null,
      license_plate: body.license_plate ?? null,
      license_state: body.license_state ?? null,
      cab_type:      body.cab_type      ?? null,
      color:         body.color         ?? null,
      dimensions:    body.dimensions    ?? null,
    })
    .select('vehicle_number, nickname')
    .single()

  if (error) return apiError('SERVER_ERROR', error.message, 500)
  return NextResponse.json(
    { vehicle_number: data.vehicle_number, nickname: data.nickname },
    { status: 201 }
  )
}
