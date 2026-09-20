// app/api/admin/orgs/[org_id]/impersonate/route.ts
// ShipmentX admin console — generate a magic link to sign in as a carrier
// org's owner (Phase 8 foundation, 2026-07-22). Restricted to sx_owner/
// sx_support (matches mockup-23's "Impersonate Owner" action). Every use is
// logged to admin_events -- this is a genuinely privileged action.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { createAuthAdminProvider } from '@/lib/auth-admin'
import { getOrgOwnerOrSolo } from '@/lib/queries/profiles'
import { logError } from '@/lib/observability'

export async function POST(request: NextRequest, { params }: { params: Promise<{ org_id: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_impersonate')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const orgId = Number((await params).org_id)
  if (!Number.isInteger(orgId)) return apiError('VALIDATION_ERROR', 'org_id must be an integer', 400)

  const { data: owner, error: ownerErr } = await getOrgOwnerOrSolo(admin, orgId)

  if (ownerErr) {
    logError({ route: 'admin/orgs/:id/impersonate', requestId: request.headers.get('x-request-id') }, ownerErr, { step: 'owner lookup' })
    return apiError('SERVER_ERROR', ownerErr.message, 500)
  }
  if (!owner) return apiError('NOT_FOUND', 'No owner/solo profile found for this org', 404)

  const authAdmin = createAuthAdminProvider(admin)
  const { data: userList } = await authAdmin.listUsers()
  const ownerEmail = userList?.users.find(u => u.id === owner.id)?.email
  if (!ownerEmail) return apiError('NOT_FOUND', 'No auth account found for this org owner', 404)

  const { data: link, error: linkErr } = await authAdmin.generateMagicLink(ownerEmail)

  if (linkErr || !link) {
    logError({ route: 'admin/orgs/:id/impersonate', requestId: request.headers.get('x-request-id') }, linkErr, { step: 'generateLink' })
    return apiError('SERVER_ERROR', linkErr?.message ?? 'Failed to generate impersonation link', 500)
  }

  await admin.from('admin_events').insert({
    org_id: orgId,
    admin_id: userId,
    event_type: 'admin.impersonate',
    metadata: { impersonated_profile_id: owner.id },
  })

  return NextResponse.json({ magic_link: link.actionLink })
}
