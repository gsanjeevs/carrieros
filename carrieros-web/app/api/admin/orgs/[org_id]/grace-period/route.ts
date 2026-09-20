// app/api/admin/orgs/[org_id]/grace-period/route.ts
// ShipmentX admin console — set/clear a carrier org's payment grace period
// (audit gap #14: Billing & Payments' real, honest scope — carrier_details.
// grace_period_until already exists and is respected wherever it's read;
// this is the missing UI-facing write path for it). sx_owner/sx_finance
// only, same role restriction as tier/trial (billing-adjacent).
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

const MAX_DAYS = 30

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ org_id: string }> }) {
  const ctx = await requireAdminRole(request, ['sx_owner', 'sx_finance'])
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const orgId = Number((await params).org_id)
  if (!Number.isInteger(orgId)) return apiError('VALIDATION_ERROR', 'org_id must be an integer', 400)

  const body = await request.json()
  // `days: null` clears the grace period; otherwise 1-30 days from now.
  const days = body?.days === null ? null : Number(body?.days)
  if (days !== null && (!Number.isInteger(days) || days <= 0 || days > MAX_DAYS))
    return apiError('VALIDATION_ERROR', `days must be null or an integer between 1 and ${MAX_DAYS}`, 400)

  const { data: before } = await admin.from('carrier_details').select('grace_period_until').eq('org_id', orgId).maybeSingle()
  if (!before) return apiError('NOT_FOUND', 'No carrier_details row found for this org', 404)

  const graceUntil = days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await admin.from('carrier_details').update({ grace_period_until: graceUntil }).eq('org_id', orgId)
  if (error) {
    logError({ route: 'admin/orgs/:id/grace-period', requestId: request.headers.get('x-request-id') }, error, { step: 'update' })
    return apiError('SERVER_ERROR', error.message, 500)
  }

  await admin.from('admin_events').insert({
    org_id: orgId,
    admin_id: userId,
    event_type: 'admin.grace_period',
    metadata: { from_grace_period_until: before.grace_period_until, to_grace_period_until: graceUntil },
  })

  return NextResponse.json({ org_id: orgId, grace_period_until: graceUntil })
}
