// app/api/vehicles/route.ts
import { generateVehicleNumber } from '@/lib/generate-number'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) return NextResponse.json([])

  const { data } = await supabase
    .from('vehicles')
    .select('id, vehicle_number, nickname, year, make, model, license_plate, license_state, is_active')
    .eq('carrier_org_id', profile.org_id)
    .eq('is_active', true)
    .order('vehicle_number')

  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id)
    return apiError('NOT_ONBOARDED', 'No company', 400)

  if (!['owner', 'solo'].includes(profile.role))
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
  return NextResponse.json(data, { status: 201 })
}
