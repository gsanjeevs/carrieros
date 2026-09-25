// app/api/admin/roles/route.ts
// ShipmentX admin console — Role Capabilities screen. role_capabilities
// (migrations 0009/0023/0024) is the source-of-truth table, but it is NOT
// read live at request time: scripts/gen-role-capabilities.mjs snapshots it
// into lib/generated/role-capabilities.ts (consumed by proxy.ts's
// ROLE_ROUTES and every roleHasCapability() call across web + mobile).
// Editing this table alone does not change gating — see
// app/api/admin/roles/regenerate/route.ts for the step that does.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

export async function GET(request: NextRequest) {
  const ctx = await requireAdminRole(request)
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const [{ data: roles, error: rolesError }, { data: grants, error: grantsError }] = await Promise.all([
    admin.from('roles').select('code, label, scope, display_order').order('display_order'),
    admin.from('role_capabilities').select('role, capability').order('role').order('capability'),
  ])

  if (rolesError || grantsError) {
    logError({ route: 'admin/roles GET', requestId: request.headers.get('x-request-id') }, rolesError ?? grantsError)
    return apiError('SERVER_ERROR', (rolesError ?? grantsError)?.message ?? 'Failed to load roles', 500)
  }

  const capabilities = [...new Set((grants ?? []).map((g) => g.capability))].sort()

  return NextResponse.json({
    roles: roles ?? [],
    capabilities,
    grants: (grants ?? []).map((g) => ({ role: g.role, capability: g.capability })),
  })
}

export async function PATCH(request: NextRequest) {
  const ctx = await requireAdminRole(request, 'admin_flags')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const body = await request.json()
  const role = body?.role
  const capability = body?.capability
  const enabled = body?.enabled

  if (typeof role !== 'string' || !role) return apiError('VALIDATION_ERROR', 'role is required', 400)
  if (typeof capability !== 'string' || !capability) return apiError('VALIDATION_ERROR', 'capability is required', 400)
  if (typeof enabled !== 'boolean') return apiError('VALIDATION_ERROR', 'enabled must be a boolean', 400)

  const { data: roleRow } = await admin.from('roles').select('code').eq('code', role).maybeSingle()
  if (!roleRow) return apiError('NOT_FOUND', 'No such role', 404)

  if (enabled) {
    const { error } = await admin.from('role_capabilities').upsert({ role, capability })
    if (error) {
      logError({ route: 'admin/roles PATCH', requestId: request.headers.get('x-request-id') }, error)
      return apiError('SERVER_ERROR', error.message, 500)
    }
  } else {
    const { error } = await admin.from('role_capabilities').delete().eq('role', role).eq('capability', capability)
    if (error) {
      logError({ route: 'admin/roles PATCH', requestId: request.headers.get('x-request-id') }, error)
      return apiError('SERVER_ERROR', error.message, 500)
    }
  }

  await admin.from('admin_events').insert({
    org_id: null,
    admin_id: userId,
    event_type: 'admin.role_capability_edit',
    metadata: { role, capability, enabled },
  })

  return NextResponse.json({ role, capability, enabled })
}
