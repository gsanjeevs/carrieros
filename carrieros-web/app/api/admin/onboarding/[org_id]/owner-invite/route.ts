import { NextRequest, NextResponse } from 'next/server'
import { apiError, isErrorResponse } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { createAuthAdminProvider } from '@/lib/auth-admin'
import { insertProfile, listProfilesForOrg } from '@/lib/queries/profiles'
import { logError } from '@/lib/observability'

export async function POST(request: NextRequest, { params }: { params: Promise<{ org_id: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_support')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx
  const orgId = Number((await params).org_id)
  if (!Number.isSafeInteger(orgId) || orgId <= 0) return apiError('VALIDATION_ERROR', 'Invalid carrier ID', 400)

  let body: unknown
  try { body = await request.json() } catch { return apiError('VALIDATION_ERROR', 'Invalid request body', 400) }
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const firstName = typeof input.first_name === 'string' ? input.first_name.trim() : ''
  const lastName = typeof input.last_name === 'string' ? input.last_name.trim() : ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return apiError('VALIDATION_ERROR', 'Enter a valid owner email', 400)
  if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80) return apiError('VALIDATION_ERROR', 'Enter the owner’s first and last name', 400)

  const { data: onboarding, error: caseError } = await admin.from('admin_carrier_onboarding')
    .select('org_id, contact_email').eq('org_id', orgId).maybeSingle()
  if (caseError) {
    logError({ route: 'admin/onboarding/:org_id/owner-invite', requestId: request.headers.get('x-request-id') }, caseError, { step: 'case' })
    return apiError('SERVER_ERROR', 'Could not verify onboarding case', 500)
  }
  if (!onboarding) return apiError('NOT_FOUND', 'Onboarding case not found', 404)

  const { data: carrierProfiles, error: ownerError } = await listProfilesForOrg(admin, orgId)
  if (ownerError) {
    logError({ route: 'admin/onboarding/:org_id/owner-invite', requestId: request.headers.get('x-request-id') }, ownerError, { step: 'owner_check' })
    return apiError('SERVER_ERROR', 'Could not verify carrier owner', 500)
  }
  if (carrierProfiles?.some(profile => profile.role === 'owner' || profile.role === 'solo')) return apiError('ALREADY_ONBOARDED', 'This carrier already has an owner account', 409)

  const { data: org, error: orgError } = await admin.from('organizations').select('name').eq('id', orgId).eq('type', 'carrier').maybeSingle()
  if (orgError || !org) {
    if (orgError) logError({ route: 'admin/onboarding/:org_id/owner-invite', requestId: request.headers.get('x-request-id') }, orgError, { step: 'org' })
    return orgError ? apiError('SERVER_ERROR', 'Could not verify carrier', 500) : apiError('NOT_FOUND', 'Carrier not found', 404)
  }

  const origin = new URL(request.url).origin
  const authAdmin = createAuthAdminProvider(admin)
  const { data: invited, error: inviteError } = await authAdmin.inviteUserByEmail(email, {
    data: { org_id: orgId, role: 'owner' },
    redirectTo: `${origin}/auth/callback`,
  })
  if (inviteError || !invited?.user) {
    const message = inviteError?.message ?? 'Invite could not be sent'
    if (inviteError?.status === 422 || /already/i.test(message)) return apiError('EMAIL_EXISTS', 'That email is already registered', 409)
    logError({ route: 'admin/onboarding/:org_id/owner-invite', requestId: request.headers.get('x-request-id') }, inviteError, { step: 'invite' })
    return apiError('SERVER_ERROR', message, 500)
  }

  const { error: profileError } = await insertProfile(admin, {
    id: invited.user.id,
    org_id: orgId,
    role: 'owner',
    first_name: firstName,
    last_name: lastName,
  })
  if (profileError) {
    logError({ route: 'admin/onboarding/:org_id/owner-invite', requestId: request.headers.get('x-request-id') }, profileError, { step: 'profile', rolled_back_auth_user: invited.user.id })
    await authAdmin.deleteUser(invited.user.id)
    return apiError('SERVER_ERROR', 'Owner invitation could not be completed', 500)
  }

  const [{ error: updateError }, { error: auditError }] = await Promise.all([
    admin.from('admin_carrier_onboarding').update({ contact_email: email, owner_invite_sent_at: new Date().toISOString() }).eq('org_id', orgId),
    admin.from('admin_events').insert({ org_id: orgId, admin_id: userId, event_type: 'admin.carrier_owner_invited', metadata: { target_user_id: invited.user.id } }),
  ])
  if (updateError || auditError) {
    logError({ route: 'admin/onboarding/:org_id/owner-invite', requestId: request.headers.get('x-request-id') }, updateError ?? auditError, { step: updateError ? 'mark_invited' : 'audit' })
  }
  return NextResponse.json({ invited: true, owner_user_id: invited.user.id, email }, { status: 201 })
}
