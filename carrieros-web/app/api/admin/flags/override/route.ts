// app/api/admin/flags/override/route.ts
// ShipmentX admin console — set a per-org feature-flag override (audit gap
// #14: Feature Flags screen). sx_owner only, matching org_flag_overrides'
// RLS write policy exactly.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

export async function POST(request: NextRequest) {
  const ctx = await requireAdminRole(request, ['sx_owner'])
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const body = await request.json()
  const orgId = Number(body?.org_id)
  const flagKey = body?.flag_key
  const enabled = body?.enabled

  if (!Number.isInteger(orgId)) return apiError('VALIDATION_ERROR', 'org_id must be an integer', 400)
  if (typeof flagKey !== 'string' || !flagKey) return apiError('VALIDATION_ERROR', 'flag_key is required', 400)
  if (typeof enabled !== 'boolean') return apiError('VALIDATION_ERROR', 'enabled must be a boolean', 400)

  const { data: org } = await admin.from('organizations').select('id').eq('id', orgId).eq('type', 'carrier').maybeSingle()
  if (!org) return apiError('NOT_FOUND', 'No carrier organization matches that id', 404)

  const { data: flag } = await admin.from('platform_flags').select('flag_key').eq('flag_key', flagKey).maybeSingle()
  if (!flag) return apiError('NOT_FOUND', 'No such feature flag', 404)

  const { error } = await admin
    .from('org_flag_overrides')
    .upsert({ org_id: orgId, flag_key: flagKey, enabled, set_by: userId, set_at: new Date().toISOString() })

  if (error) {
    logError({ route: 'admin/flags/override POST', requestId: request.headers.get('x-request-id') }, error)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  await admin.from('admin_events').insert({
    org_id: orgId,
    admin_id: userId,
    event_type: 'admin.flag_edit',
    metadata: { flag_key: flagKey, enabled },
  })

  return NextResponse.json({ org_id: orgId, flag_key: flagKey, enabled })
}
