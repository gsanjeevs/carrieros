// app/api/customers/[org_id]/contacts/route.ts
// Customer contacts (Phase 3H) — carrier staff managing a customer's list of
// people, some of whom may separately be invited to portal login via the
// sibling invite/route.ts. Plain RLS-scoped reads/writes (no admin client
// needed here — the write itself is just an insert into customer_contacts,
// not an auth.users creation, which is what pushes invite/revoke into their
// own routes per R3b).
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ org_id: string }> }
) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase } = ctx
  const { org_id } = await params

  const { data, error } = await supabase
    .from('customer_contacts')
    .select('id, name, email, phone, title, is_primary, portal_profile_id, created_at')
    .eq('org_id', Number(org_id))
    .order('is_primary', { ascending: false })
    .order('created_at')

  if (error) return apiError('SERVER_ERROR', error.message, 500)

  // Rule C (docs/architecture-principles.md) — explicit DTO, even though
  // this is a 1:1 mapping today.
  const contacts = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    title: c.title,
    is_primary: c.is_primary,
    portal_profile_id: c.portal_profile_id,
    created_at: c.created_at,
  }))

  return NextResponse.json(contacts)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ org_id: string }> }
) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx
  const { org_id } = await params

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No company', 400)
  if (!['owner', 'solo', 'dispatcher'].includes(profile.role))
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  const body = await request.json()
  if (!body.name || typeof body.name !== 'string' || !body.name.trim())
    return apiError('VALIDATION_ERROR', 'name is required', 400)

  const { data, error } = await supabase
    .from('customer_contacts')
    .insert({
      org_id:         Number(org_id),
      carrier_org_id: profile.org_id,
      name:           body.name.trim(),
      email:          body.email  ?? null,
      phone:          body.phone  ?? null,
      title:          body.title  ?? null,
      is_primary:     body.is_primary === true,
    })
    .select('id, name, email, phone, title, is_primary, portal_profile_id, created_at')
    .single()

  if (error) return apiError('SERVER_ERROR', error.message, 500)
  return NextResponse.json(data, { status: 201 })
}
