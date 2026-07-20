// app/api/loads/route.ts
import { generateLoadNumber } from '@/lib/generate-number'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) {
    return apiError('NOT_ONBOARDED', 'No organization found for this user', 400)
  }

  if (!['owner', 'solo', 'dispatcher'].includes(profile.role)) {
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400)
  }

  const load_number = await generateLoadNumber(supabase, profile.org_id)

  const { data: load, error } = await supabase
    .from('loads')
    .insert({
      carrier_org_id:    profile.org_id,
      load_number,
      customer_name_raw: body.customer_name_raw ?? null,
      pickup_address:    body.pickup_address    ?? null,
      pickup_city:       body.pickup_city       ?? null,
      pickup_state:      body.pickup_state      ?? null,
      pickup_zip:        body.pickup_zip        ?? null,
      pickup_date:       body.pickup_date       ?? null,
      pickup_time:       body.pickup_time       ?? null,
      delivery_address:  body.delivery_address  ?? null,
      delivery_city:     body.delivery_city     ?? null,
      delivery_state:    body.delivery_state    ?? null,
      delivery_zip:      body.delivery_zip      ?? null,
      delivery_date:     body.delivery_date     ?? null,
      delivery_time:     body.delivery_time     ?? null,
      commodity:         body.commodity         ?? null,
      weight_lbs:        body.weight_lbs        ?? null,
      rate:              body.rate              ?? null,
      total_miles:       body.total_miles       ?? null,
      intake_method:     body.intake_method     ?? 'manual',
      raw_intake_text:   body.raw_intake_text   ?? null,
      status:           'draft',
    })
    .select('load_number')
    .single()

  if (error) {
    console.error('[api/loads POST]', error)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  return NextResponse.json({ load_number: load.load_number }, { status: 201 })
}
