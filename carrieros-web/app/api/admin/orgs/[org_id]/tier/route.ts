// app/api/admin/orgs/[org_id]/tier/route.ts
// ShipmentX admin console — change a carrier org's tier (Phase 8
// foundation, 2026-07-22). sx_owner/sx_finance only (billing-adjacent).
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

const VALID_TIERS = ['starter', 'growth', 'pro', 'enterprise'] as const

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ org_id: string }> }) {
  const ctx = await requireAdminRole(request, ['sx_owner', 'sx_finance'])
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const orgId = Number((await params).org_id)
  if (!Number.isInteger(orgId)) return apiError('VALIDATION_ERROR', 'org_id must be an integer', 400)

  const body = await request.json()
  const tier = body?.tier
  if (!VALID_TIERS.includes(tier))
    return apiError('VALIDATION_ERROR', `tier must be one of ${VALID_TIERS.join(', ')}`, 400)

  const { data: before } = await admin.from('carrier_details').select('tier').eq('org_id', orgId).maybeSingle()
  if (!before) return apiError('NOT_FOUND', 'No carrier_details row found for this org', 404)

  const { error } = await admin.from('carrier_details').update({ tier }).eq('org_id', orgId)
  if (error) {
    logError({ route: 'admin/orgs/:id/tier', requestId: request.headers.get('x-request-id') }, error, { step: 'update' })
    return apiError('SERVER_ERROR', error.message, 500)
  }

  await admin.from('admin_events').insert({
    org_id: orgId,
    admin_id: userId,
    event_type: 'admin.change_tier',
    metadata: { from_tier: before.tier, to_tier: tier },
  })

  return NextResponse.json({ org_id: orgId, tier })
}
