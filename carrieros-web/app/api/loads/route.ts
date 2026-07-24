// app/api/loads/route.ts
import { generateLoadNumber } from '@/lib/generate-number'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'
import { createLoad } from '@/lib/queries/loads'

// The request body is untrusted JSON, so every field is narrowed to the
// column's actual type before it reaches the insert. Absent/empty means null;
// a value of the wrong shape (an object where a string belongs, a
// non-numeric weight) is a client error, not something to coerce silently.
class InvalidField extends Error {
  constructor(field: string) { super(`Invalid value for "${field}"`) }
}

function text(body: Record<string, unknown>, field: string): string | null {
  const v = body[field]
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  throw new InvalidField(field)
}

function number(body: Record<string, unknown>, field: string): number | null {
  const v = body[field]
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) throw new InvalidField(field)
  return n
}

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

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

  let values
  try {
    values = {
      customer_name_raw: text(body, 'customer_name_raw'),
      pickup_address:    text(body, 'pickup_address'),
      pickup_city:       text(body, 'pickup_city'),
      pickup_state:      text(body, 'pickup_state'),
      pickup_zip:        text(body, 'pickup_zip'),
      pickup_date:       text(body, 'pickup_date'),
      pickup_time:       text(body, 'pickup_time'),
      delivery_address:  text(body, 'delivery_address'),
      delivery_city:     text(body, 'delivery_city'),
      delivery_state:    text(body, 'delivery_state'),
      delivery_zip:      text(body, 'delivery_zip'),
      delivery_date:     text(body, 'delivery_date'),
      delivery_time:     text(body, 'delivery_time'),
      commodity:         text(body, 'commodity'),
      weight_lbs:        number(body, 'weight_lbs'),
      rate:              number(body, 'rate'),
      total_miles:       number(body, 'total_miles'),
      intake_method:     text(body, 'intake_method') ?? 'manual',
      raw_intake_text:   text(body, 'raw_intake_text'),
    }
  } catch (e) {
    if (e instanceof InvalidField) return apiError('VALIDATION_ERROR', e.message, 400)
    throw e
  }

  // Only after the body validates — next_entity_val() burns a sequence value
  // on every call, so a rejected request must not consume a load number.
  const load_number = await generateLoadNumber(supabase, profile.org_id)

  const { data: load, error } = await createLoad(supabase, {
    carrier_org_id: profile.org_id,
    load_number,
    status: 'draft',
    ...values,
  })

  if (error) {
    console.error('[api/loads POST]', error)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  return NextResponse.json({ load_number: load.load_number }, { status: 201 })
}
