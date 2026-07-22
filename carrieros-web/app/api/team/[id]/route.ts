// app/api/team/[id]/route.ts
// PATCH  — change an existing team member's role
// DELETE — remove a team member entirely (auth.users row; profiles cascades)
//
// Both need the service-role admin client (decision R3b category 1): the
// `own_profile_update` RLS policy pins role and org_id via my_role()/
// my_org_id(), so *nobody* can change *anybody's* role through the anon
// client — not even an owner changing someone else's. That is deliberate;
// the escalation guard lives here instead, where it can be explicit.
//
// Two invariants enforced server-side (the UI also hides these actions, but
// hiding a button is not a control):
//   1. Nobody may change their OWN role. Straight privilege escalation.
//   2. The LAST owner/solo in an org may not be demoted or removed. That
//      would leave the account with no one able to administer it.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError, createAdminClient } from '@/lib/api-auth'
import { hasFeature } from '@/lib/entitlements'

const ASSIGNABLE_ROLES = ['dispatcher', 'finance', 'owner'] as const
const ADMIN_ROLES = ['owner', 'solo']

type Ctx = { params: Promise<{ id: string }> }

// Resolves the caller and the target member, or a response to short-circuit
// with. Shared by PATCH and DELETE so the two can't drift apart.
async function resolve(request: NextRequest, targetId: string) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return { error: ctx }
  const { supabase, user } = ctx

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id)
    return { error: apiError('NOT_ONBOARDED', 'No organization found for this user', 400) }
  if (!ADMIN_ROLES.includes(profile.role))
    return { error: apiError('FORBIDDEN', 'Only owner/solo can manage team members', 403) }

  const admin = createAdminClient()

  const { data: target } = await admin
    .from('profiles')
    .select('id, org_id, role')
    .eq('id', targetId)
    .maybeSingle()

  // Scoped to the caller's org, so a bad id and another tenant's id are
  // indistinguishable from the outside — no cross-tenant existence probe.
  if (!target || target.org_id !== profile.org_id)
    return { error: apiError('NOT_FOUND', 'No such team member', 404) }

  return { admin, supabase, callerId: user.id, orgId: profile.org_id, target }
}

// Count of remaining admins if `excludingId` stopped being one.
async function adminCount(
  admin: ReturnType<typeof createAdminClient>,
  orgId: number
): Promise<number> {
  const { count } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .in('role', ADMIN_ROLES)
  return count ?? 0
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const r = await resolve(request, id)
  if (r.error) return r.error
  const { admin, supabase, callerId, orgId, target } = r

  const body = await request.json()
  const role = body?.role

  if (!ASSIGNABLE_ROLES.includes(role))
    return apiError('VALIDATION_ERROR', `role must be one of ${ASSIGNABLE_ROLES.join(', ')}`, 400)

  // Added 2026-07-21: same gate as app/api/team/invite/route.ts — BRD §9 puts
  // Dispatcher/Finance at Growth+. This route re-roles an EXISTING member, a
  // second path to the same escalation the invite route already guarded;
  // found by reading this file directly during a tier-coverage re-audit.
  // Uses the CALLER's own session client (not `admin`, which has no JWT/
  // auth.uid() context and would make my_org_id() resolve to null).
  if (role === 'dispatcher' || role === 'finance') {
    const entitled = await hasFeature(supabase, 'dispatcher_finance_roles')
    if (!entitled) {
      return apiError(
        'TIER_UPGRADE_REQUIRED',
        'Dispatcher and Finance roles require the Growth plan or above',
        403
      )
    }
  }

  // Drivers (and solos, who also drive) have a `drivers` row keyed to their
  // profile. Re-roling them here would strand it; /drivers owns that.
  if (['driver', 'solo'].includes(target.role))
    return apiError('MANAGE_DRIVER_ELSEWHERE', 'Manage driver accounts from the Drivers page', 400)

  if (role === target.role) return NextResponse.json({ id: target.id, role })

  // Invariant 2 — never demote the last admin. Checked BEFORE the self-check
  // on purpose: only an owner/solo gets this far, so if the target is also an
  // admin and is not the caller, the org already has two admins and the count
  // can never be 1. Ordering it second would make this branch unreachable —
  // dead code that reads like a control. Org integrity is also the more
  // fundamental invariant of the two, so it earns the earlier check.
  if (ADMIN_ROLES.includes(target.role) && !ADMIN_ROLES.includes(role)) {
    if ((await adminCount(admin, orgId)) <= 1)
      return apiError('LAST_OWNER', 'An organization must keep at least one owner', 409)
  }

  // Invariant 1 — no self-escalation, regardless of what the UI offered.
  if (target.id === callerId)
    return apiError('SELF_ROLE_CHANGE', 'You cannot change your own role', 403)

  const { error } = await admin.from('profiles').update({ role }).eq('id', target.id)
  if (error) {
    console.error('[team/:id] role update:', error)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  return NextResponse.json({ id: target.id, role })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const r = await resolve(request, id)
  if (r.error) return r.error
  const { admin, callerId, orgId, target } = r

  if (['driver', 'solo'].includes(target.role))
    return apiError('MANAGE_DRIVER_ELSEWHERE', 'Manage driver accounts from the Drivers page', 400)

  // Same ordering rationale as PATCH — last-admin first, otherwise the
  // self-check masks it and this branch can never run.
  if (ADMIN_ROLES.includes(target.role) && (await adminCount(admin, orgId)) <= 1)
    return apiError('LAST_OWNER', 'An organization must keep at least one owner', 409)

  if (target.id === callerId)
    return apiError('CANNOT_REMOVE_SELF', 'You cannot remove your own account', 403)

  // profiles.id REFERENCES auth.users(id) ON DELETE CASCADE, so removing the
  // auth user removes the profile too — one call, no orphan window.
  const { error } = await admin.auth.admin.deleteUser(target.id)
  if (error) {
    console.error('[team/:id] delete:', error)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  return NextResponse.json({ id: target.id, removed: true })
}
