// lib/admin-auth.ts
// Shared auth guard for the ShipmentX admin console (Phase 8 foundation,
// 2026-07-22). ShipmentX platform staff are ordinary profiles rows in a
// 'platform'-type organizations row, with role IN
// ('sx_owner','sx_finance','sx_support') — no separate auth system, same
// session/magic-link machinery as every other user (see
// scripts/bootstrap-shipmentx.mjs and supabase/schema/schema.sql SECTION 3c
// for the full reasoning).
//
// CRITICAL: every /api/admin/** route must call requireAdminRole() first,
// then do ALL its data access (including cross-org reads of ordinary tenant
// tables like organizations/carrier_details/loads) through the returned
// service-role `admin` client — never the caller's own session client for
// this domain. A ShipmentX profile's own session is still subject to normal
// RLS (their my_org_id() resolves to ShipmentX's own org, which has no
// loads/invoices/etc.) — the authorization check here is what stands in for
// RLS on the cross-tenant reads these routes need to do.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError, createAdminClient } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability, rolesWithCapability, type RoleCapability } from '@/lib/generated/role-capabilities'

// The platform-staff roles are exactly those holding the 'admin' console capability, so this derives
// from role_capabilities rather than restating the list (migrations 0009/0023).
export const SX_ROLES = rolesWithCapability('admin') as readonly SxRole[]
export type SxRole = 'sx_owner' | 'sx_finance' | 'sx_support'

type AdminContext = {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  role: SxRole
}

// `capability` narrows which sx_* roles may proceed for routes needing finer permissioning than "any
// ShipmentX staff": 'admin_billing' for the commercial actions (tier, trial, grace period, feature
// overrides, pipeline), 'admin_flags' for kill switches, 'admin_impersonate' for impersonation. Which
// roles hold each lives in role_capabilities (migration 0023), never in a list written at the call site.
// Omitted means "any ShipmentX staff", i.e. the console-access capability itself.
export async function requireAdminRole(
  request: NextRequest,
  capability: RoleCapability = 'admin'
): Promise<AdminContext | NextResponse> {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

  const role = profile?.role as SxRole | undefined
  if (!role || !SX_ROLES.includes(role))
    return apiError('FORBIDDEN', 'ShipmentX admin access required', 403)

  if (!roleHasCapability(role, capability))
    return apiError('FORBIDDEN', 'Your ShipmentX role cannot perform this action', 403)

  return { admin: createAdminClient(), userId: user.id, role }
}
