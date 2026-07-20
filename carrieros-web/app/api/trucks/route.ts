// app/api/trucks/route.ts
import { generateTruckNumber } from '@/lib/generate-number'
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
    .from('trucks')
    .select('id, truck_number, nickname, year, make, model, license_plate, license_state, is_active')
    .eq('carrier_org_id', profile.org_id)
    .eq('is_active', true)
    .order('truck_number')

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

  const truck_number = await generateTruckNumber(supabase, profile.org_id)

  const { data, error } = await supabase
    .from('trucks')
    .insert({
      carrier_org_id:    profile.org_id,
      truck_number,
      nickname:      body.nickname,
      year:          body.year          ?? null,
      make:          body.make          ?? null,
      model:         body.model         ?? null,
      vin:           body.vin           ?? null,
      license_plate: body.license_plate ?? null,
      license_state: body.license_state ?? null,
    })
    .select('truck_number, nickname')
    .single()

  if (error) return apiError('SERVER_ERROR', error.message, 500)
  return NextResponse.json(data, { status: 201 })
}
