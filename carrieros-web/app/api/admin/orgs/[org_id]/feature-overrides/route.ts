// app/api/admin/orgs/[org_id]/feature-overrides/route.ts
// ShipmentX admin console — grant or deny ONE feature for ONE carrier org without changing its tier (a pilot, a
// goodwill unlock, a suspension of a single capability). Evaluated by entitlement_decision() (migration 0021), so it
// takes effect on the carrier's next request. sx_owner/sx_finance only, like tier changes; every change is audited.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

type Ctx = { params: Promise<{ org_id: string }> }

async function parseOrg(params: Ctx['params']) {
  const orgId = Number((await params).org_id)
  return Number.isInteger(orgId) ? orgId : null
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const ctx = await requireAdminRole(request, 'admin_billing')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const orgId = await parseOrg(params)
  if (orgId === null) return apiError('VALIDATION_ERROR', 'org_id must be an integer', 400)

  const body = await request.json().catch(() => null)
  const featureKey = body?.feature_key
  const effect = body?.effect
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  const expiresAt = body?.expires_at ?? null

  if (typeof featureKey !== 'string' || !featureKey) return apiError('VALIDATION_ERROR', 'feature_key is required', 400)
  if (effect !== 'grant' && effect !== 'deny') return apiError('VALIDATION_ERROR', "effect must be 'grant' or 'deny'", 400)
  if (!reason) return apiError('VALIDATION_ERROR', 'reason is required (it is shown in the audit log)', 400)
  if (expiresAt !== null && (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt))))
    return apiError('VALIDATION_ERROR', 'expires_at must be an ISO timestamp or null', 400)

  const { data: org } = await admin.from('carrier_details').select('org_id').eq('org_id', orgId).maybeSingle()
  if (!org) return apiError('NOT_FOUND', 'No carrier organization matches that id', 404)
  const { data: feature } = await admin.from('features').select('key').eq('key', featureKey).maybeSingle()
  if (!feature) return apiError('NOT_FOUND', 'No such feature', 404)

  const { error } = await admin.from('org_feature_overrides').upsert({
    org_id: orgId, feature_key: featureKey, effect, reason, expires_at: expiresAt, set_by: userId, set_at: new Date().toISOString(),
  })
  if (error) {
    logError({ route: 'admin/orgs/:id/feature-overrides PUT', requestId: request.headers.get('x-request-id') }, error)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  await admin.from('admin_events').insert({
    org_id: orgId, admin_id: userId, event_type: 'admin.feature_override',
    metadata: { feature_key: featureKey, effect, reason, expires_at: expiresAt },
  })
  return NextResponse.json({ org_id: orgId, feature_key: featureKey, effect, expires_at: expiresAt })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const ctx = await requireAdminRole(request, 'admin_billing')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const orgId = await parseOrg(params)
  if (orgId === null) return apiError('VALIDATION_ERROR', 'org_id must be an integer', 400)
  const body = await request.json().catch(() => null)
  const featureKey = body?.feature_key
  if (typeof featureKey !== 'string' || !featureKey) return apiError('VALIDATION_ERROR', 'feature_key is required', 400)

  const { data: removed, error } = await admin
    .from('org_feature_overrides').delete().eq('org_id', orgId).eq('feature_key', featureKey).select('effect')
  if (error) {
    logError({ route: 'admin/orgs/:id/feature-overrides DELETE', requestId: request.headers.get('x-request-id') }, error)
    return apiError('SERVER_ERROR', error.message, 500)
  }
  if (!removed?.length) return apiError('NOT_FOUND', 'No override for that feature', 404)

  await admin.from('admin_events').insert({
    org_id: orgId, admin_id: userId, event_type: 'admin.feature_override_removed',
    metadata: { feature_key: featureKey, effect: removed[0].effect },
  })
  return NextResponse.json({ org_id: orgId, feature_key: featureKey, removed: true })
}
