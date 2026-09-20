// app/api/customers/route.ts
// customers are now organizations (type='customer') + customer_details.
// POST delegates to the create_customer_org() Postgres RPC (SECURITY DEFINER)
// so the two-table insert is atomic and the org/role check happens in one
// place — the same RPC is callable directly from carrieros-mobile via
// supabase.rpc(), with zero Next.js layer needed there.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'
import { logError } from '@/lib/observability'

export async function GET(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) return NextResponse.json([])

  // customer_details has two FKs to organizations (org_id, carrier_org_id),
  // so the embed must name the relationship explicitly — the bare
  // `organizations(...)` form is ambiguous and PostgREST rejects it (PGRST201).
  const { data, error } = await supabase
    .from('customer_details')
    .select('org_id, customer_number, contact_name, tags, notes, organizations!customer_details_org_id_fkey(id, name, email, phone, city, state)')
    .eq('carrier_org_id', profile.org_id)
    .order('org_id')

  if (error) {
    logError({ route: 'api/customers GET', requestId: request.headers.get('x-request-id') }, error)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  // Rule C (docs/architecture-principles.md) — the raw row's
  // `organizations!customer_details_org_id_fkey` key is a PostgREST
  // relationship-embed artifact, not a wire contract any consumer should
  // have to know about. Flatten into a plain DTO instead.
  const customers = (data ?? []).map((c) => ({
    org_id: c.org_id,
    customer_number: c.customer_number,
    contact_name: c.contact_name,
    tags: c.tags,
    notes: c.notes,
    name: c.organizations?.name ?? null,
    email: c.organizations?.email ?? null,
    phone: c.organizations?.phone ?? null,
    city: c.organizations?.city ?? null,
    state: c.organizations?.state ?? null,
  }))

  return NextResponse.json(customers)
}

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase } = ctx

  const body = await request.json()
  if (!body.name || typeof body.name !== 'string' || !body.name.trim())
    return apiError('VALIDATION_ERROR', 'name is required', 400)

  const { data, error } = await supabase.rpc('create_customer_org', {
    p_name:         body.name,
    p_phone:        body.phone        ?? null,
    p_email:        body.email        ?? null,
    p_address:      body.address      ?? null,
    p_city:         body.city         ?? null,
    p_state:        body.state        ?? null,
    p_zip:          body.zip          ?? null,
    p_country:      body.country      ?? 'US',
    p_contact_name: body.contact_name ?? null,
    p_notes:        body.notes        ?? null,
  })

  if (error) {
    if (error.message.includes('NO_ORGANIZATION'))
      return apiError('NOT_ONBOARDED', error.message, 400)
    if (error.message.includes('FORBIDDEN'))
      return apiError('FORBIDDEN', error.message, 403)
    if (error.message.includes('VALIDATION_ERROR'))
      return apiError('VALIDATION_ERROR', error.message, 400)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  const row = Array.isArray(data) ? data[0] : data
  return NextResponse.json(
    { org_id: row.org_id, name: row.name, customer_number: row.customer_number },
    { status: 201 }
  )
}
