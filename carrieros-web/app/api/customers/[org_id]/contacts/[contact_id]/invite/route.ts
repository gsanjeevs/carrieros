// app/api/customers/[org_id]/contacts/[contact_id]/invite/route.ts
// Grants a customer_contacts row portal login — mirrors app/api/team/invite's
// admin-client magic-link pattern (needs the service-role Admin Auth API,
// which can never run in the browser, per R3b).
//
// The CALLER is the carrier (owner/solo/dispatcher) deciding which of THEIR
// customer's people can see tracking/loads/invoices — this is not a
// customer self-signup flow. role defaults to 'customer_viewer'; the caller
// may request 'customer_admin' instead (both are real profiles.role values
// with real RLS policies already; this route is what finally connects them
// to anything, per Phase 3H's whole reason for existing).
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError, createAdminClient } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'
import { createAuthAdminProvider } from '@/lib/auth-admin'

const INVITABLE_PORTAL_ROLES = ['customer_admin', 'customer_viewer'] as const

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ org_id: string; contact_id: string }> }
) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx
  const { org_id, contact_id } = await params

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No company', 400)
  if (!['owner', 'solo', 'dispatcher'].includes(profile.role))
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  const { data: contact } = await supabase
    .from('customer_contacts')
    .select('id, org_id, carrier_org_id, name, email, portal_profile_id')
    .eq('id', Number(contact_id))
    .eq('org_id', Number(org_id))
    .eq('carrier_org_id', profile.org_id)
    .maybeSingle()

  if (!contact) return apiError('NOT_FOUND', 'Contact not found', 404)
  if (contact.portal_profile_id) return apiError('VALIDATION_ERROR', 'This contact already has portal access', 400)
  if (!contact.email) return apiError('VALIDATION_ERROR', 'This contact has no email on file', 400)

  const body = await request.json().catch(() => ({}))
  const role = body.role ?? 'customer_viewer'
  if (!INVITABLE_PORTAL_ROLES.includes(role))
    return apiError('VALIDATION_ERROR', `role must be one of ${INVITABLE_PORTAL_ROLES.join(', ')}`, 400)

  const admin = createAdminClient()
  const authAdmin = createAuthAdminProvider(admin)
  const origin = new URL(request.url).origin

  // 1. Send the magic-link invite (creates the auth.users row). The invited
  //    user belongs to the CUSTOMER org (org_id), not the inviting carrier —
  //    that's what makes customer_loads_select/customer_invoices_select scope
  //    them to only their own org's data.
  const [firstName, ...rest] = contact.name.trim().split(' ')
  const { data: inviteData, error: inviteErr } = await authAdmin.inviteUserByEmail(
    contact.email.trim(),
    {
      data: { org_id: contact.org_id, role },
      redirectTo: `${origin}/auth/callback`,
    }
  )

  if (inviteErr || !inviteData?.user) {
    const msg = inviteErr?.message ?? ''
    if (inviteErr?.status === 422 || /already/i.test(msg))
      return apiError('EMAIL_EXISTS', msg || 'That email is already registered', 409)
    console.error('[customers/contacts/invite] invite:', inviteErr)
    return apiError('SERVER_ERROR', msg || 'Failed to send invite', 500)
  }

  const newUserId = inviteData.user.id

  // 2. Create the profile row immediately, same reasoning as team/invite —
  //    the invitee has no session yet to satisfy own_profile_insert.
  const { error: profileErr } = await admin.from('profiles').insert({
    id:         newUserId,
    org_id:     contact.org_id,
    role,
    first_name: firstName || null,
    last_name:  rest.join(' ') || null,
  })

  if (profileErr) {
    console.error('[customers/contacts/invite] profile:', profileErr)
    await authAdmin.deleteUser(newUserId).catch(() => {})
    return apiError('SERVER_ERROR', profileErr.message, 500)
  }

  // 3. Link the contact row to the new portal profile.
  const { error: linkErr } = await admin
    .from('customer_contacts')
    .update({ portal_profile_id: newUserId })
    .eq('id', contact.id)

  if (linkErr) {
    console.error('[customers/contacts/invite] link:', linkErr)
    return apiError('SERVER_ERROR', linkErr.message, 500)
  }

  return NextResponse.json({ id: newUserId, email: contact.email, role }, { status: 201 })
}
