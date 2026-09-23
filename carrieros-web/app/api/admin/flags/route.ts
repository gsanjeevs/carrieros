// app/api/admin/flags/route.ts
// ShipmentX admin console — Feature Flags screen (audit gap #14).
// platform_flags/org_flag_overrides had schema + RLS (write restricted to
// sx_owner) but no API route until now.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

export async function GET(request: NextRequest) {
  const ctx = await requireAdminRole(request)
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const [{ data: flags, error: flagsError }, { data: overrides, error: overridesError }] = await Promise.all([
    admin.from('platform_flags').select('flag_key, description, default_enabled, created_at').order('flag_key'),
    admin
      .from('org_flag_overrides')
      .select('org_id, flag_key, enabled, set_at, organizations(name)')
      .order('set_at', { ascending: false }),
  ])

  if (flagsError || overridesError) {
    logError({ route: 'admin/flags GET', requestId: request.headers.get('x-request-id') }, flagsError ?? overridesError)
    return apiError('SERVER_ERROR', (flagsError ?? overridesError)?.message ?? 'Failed to load flags', 500)
  }

  return NextResponse.json({
    flags: flags ?? [],
    overrides: (overrides ?? []).map((o) => ({
      org_id: o.org_id,
      org_name: (o.organizations as { name: string } | null)?.name ?? null,
      flag_key: o.flag_key,
      enabled: o.enabled,
      set_at: o.set_at,
    })),
  })
}

export async function PATCH(request: NextRequest) {
  const ctx = await requireAdminRole(request, 'admin_flags')
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const body = await request.json()
  const flagKey = body?.flag_key
  const defaultEnabled = body?.default_enabled
  if (typeof flagKey !== 'string' || !flagKey)
    return apiError('VALIDATION_ERROR', 'flag_key is required', 400)
  if (typeof defaultEnabled !== 'boolean')
    return apiError('VALIDATION_ERROR', 'default_enabled must be a boolean', 400)

  const { error } = await admin.from('platform_flags').update({ default_enabled: defaultEnabled }).eq('flag_key', flagKey)
  if (error) {
    logError({ route: 'admin/flags PATCH', requestId: request.headers.get('x-request-id') }, error)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  return NextResponse.json({ flag_key: flagKey, default_enabled: defaultEnabled })
}
