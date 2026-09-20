// app/api/customers/[org_id]/contacts/[contact_id]/revoke/route.ts
// Revokes a customer contact's portal access. Per the 2026-07-21
// deactivate-not-delete directive: this deactivates the linked profiles row
// (is_active = false) and nulls customer_contacts.portal_profile_id — it
// never deletes either row. Needs the admin client because updating ANOTHER
// user's profiles row isn't something own_profile_update's RLS policy
// permits (by design — see that policy's own comment), so this is a
// service-role operation, same R3b reasoning as every other admin-client
// route in this codebase.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError, createAdminClient } from '@/lib/api-auth'
import { getProfileForUser, setProfileActive } from '@/lib/queries/profiles'
import { logError } from '@/lib/observability'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

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
  if (!roleHasCapability(profile.role, 'customers_manage'))
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  const { data: contact } = await supabase
    .from('customer_contacts')
    .select('id, portal_profile_id')
    .eq('id', Number(contact_id))
    .eq('org_id', Number(org_id))
    .eq('carrier_org_id', profile.org_id)
    .maybeSingle()

  if (!contact) return apiError('NOT_FOUND', 'Contact not found', 404)
  if (!contact.portal_profile_id) return apiError('VALIDATION_ERROR', 'This contact has no portal access to revoke', 400)

  const admin = createAdminClient()

  const { error: deactivateErr } = await setProfileActive(admin, contact.portal_profile_id, false)

  if (deactivateErr) {
    logError({ route: 'customers/contacts/revoke', requestId: request.headers.get('x-request-id') }, deactivateErr, { step: 'deactivate' })
    return apiError('SERVER_ERROR', deactivateErr.message, 500)
  }

  const { error: unlinkErr } = await admin
    .from('customer_contacts')
    .update({ portal_profile_id: null })
    .eq('id', contact.id)

  if (unlinkErr) {
    logError({ route: 'customers/contacts/revoke', requestId: request.headers.get('x-request-id') }, unlinkErr, { step: 'unlink' })
    return apiError('SERVER_ERROR', unlinkErr.message, 500)
  }

  return NextResponse.json({ id: contact.id }, { status: 200 })
}
