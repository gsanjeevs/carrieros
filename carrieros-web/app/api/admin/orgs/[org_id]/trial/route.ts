// app/api/admin/orgs/[org_id]/trial/route.ts
// ShipmentX admin console — extend a carrier org's trial (audit gap #14:
// Triage Queue's and Sales Pipeline's "Extend Trial" action). Mirrors
// .../tier/route.ts exactly: sx_owner/sx_finance only (billing-adjacent),
// same admin_events logging shape.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

const MAX_DAYS = 90

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ org_id: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_billing')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const orgId = Number((await params).org_id)
  if (!Number.isInteger(orgId)) return apiError('VALIDATION_ERROR', 'org_id must be an integer', 400)

  const body = await request.json()
  const days = Number(body?.days)
  if (!Number.isInteger(days) || days <= 0 || days > MAX_DAYS)
    return apiError('VALIDATION_ERROR', `days must be an integer between 1 and ${MAX_DAYS}`, 400)

  const { data: before } = await admin.from('carrier_details').select('trial_ends_at').eq('org_id', orgId).maybeSingle()
  if (!before) return apiError('NOT_FOUND', 'No carrier_details row found for this org', 404)

  // Extend from whichever is later — "now" (if the trial already lapsed)
  // or the existing trial_ends_at (if it hasn't) — so extending a trial
  // that still has 10 days left adds days on top rather than shortening it.
  const base = before.trial_ends_at && new Date(before.trial_ends_at) > new Date()
    ? new Date(before.trial_ends_at)
    : new Date()
  const newTrialEndsAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await admin.from('carrier_details').update({ trial_ends_at: newTrialEndsAt }).eq('org_id', orgId)
  if (error) {
    logError({ route: 'admin/orgs/:id/trial', requestId: request.headers.get('x-request-id') }, error, { step: 'update' })
    return apiError('SERVER_ERROR', error.message, 500)
  }

  await admin.from('admin_events').insert({
    org_id: orgId,
    admin_id: userId,
    event_type: 'admin.extend_trial',
    metadata: { from_trial_ends_at: before.trial_ends_at, to_trial_ends_at: newTrialEndsAt, days },
  })

  return NextResponse.json({ org_id: orgId, trial_ends_at: newTrialEndsAt })
}
