import { NextRequest, NextResponse } from 'next/server'
import { apiError, isErrorResponse } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { createAuthAdminProvider } from '@/lib/auth-admin'
import { listProfilesForOrg } from '@/lib/queries/profiles'
import { countLoadsForOrg } from '@/lib/queries/loads'
import { countAcceptedActiveDriversForOrg } from '@/lib/queries/drivers'
import { logError } from '@/lib/observability'

const STAGES = ['intake', 'setup', 'training', 'launch_ready', 'live', 'blocked'] as const

async function parseOrgId(raw: string) {
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ org_id: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_support')
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx
  const orgId = await parseOrgId((await params).org_id)
  if (!orgId) return apiError('VALIDATION_ERROR', 'Invalid carrier ID', 400)

  const { data: onboarding, error: caseError } = await admin.from('admin_carrier_onboarding')
    .select('org_id, contact_name, contact_email, stage, next_action, next_follow_up_at, blocker_note, owner_invite_sent_at, created_at, updated_at, organizations!admin_carrier_onboarding_org_id_fkey(name, carrier_details(tier, billing_status))')
    .eq('org_id', orgId).maybeSingle()
  if (caseError) {
    logError({ route: 'admin/onboarding/:org_id GET', requestId: request.headers.get('x-request-id') }, caseError, { step: 'case' })
    return apiError('SERVER_ERROR', 'Could not load onboarding case', 500)
  }
  if (!onboarding) return apiError('NOT_FOUND', 'Onboarding case not found', 404)

  const [profiles, vehicles, drivers, loads, invoices] = await Promise.all([
    listProfilesForOrg(admin, orgId),
    admin.from('vehicles').select('id', { count: 'exact', head: true }).eq('carrier_org_id', orgId).eq('is_active', true).eq('status', 'active'),
    countAcceptedActiveDriversForOrg(admin, orgId),
    countLoadsForOrg(admin, orgId),
    admin.from('invoices').select('id', { count: 'exact', head: true }).eq('carrier_org_id', orgId),
  ])
  const queryError = profiles.error ?? vehicles.error ?? drivers.error ?? loads.error ?? invoices.error
  if (queryError) {
    logError({ route: 'admin/onboarding/:org_id GET', requestId: request.headers.get('x-request-id') }, queryError, { step: 'milestones' })
    return apiError('SERVER_ERROR', 'Could not load onboarding progress', 500)
  }

  const activeProfiles = (profiles.data ?? []).filter(profile => profile.is_active)
  const owner = activeProfiles.find(profile => profile.role === 'owner' || profile.role === 'solo') ?? null
  const authResult = owner ? await createAuthAdminProvider(admin).getUserById(owner.id) : null
  if (authResult?.error && authResult.error.status !== 404) {
    logError({ route: 'admin/onboarding/:org_id GET', requestId: request.headers.get('x-request-id') }, authResult.error, { step: 'owner_auth' })
    return apiError('SERVER_ERROR', 'Could not load owner invitation state', 500)
  }
  const authUser = authResult?.error?.status === 404 ? null : authResult?.data?.user ?? null
  const org = onboarding.organizations as { name: string; carrier_details: { tier: string; billing_status: string } | { tier: string; billing_status: string }[] | null } | null
  const details = Array.isArray(org?.carrier_details) ? org.carrier_details[0] : org?.carrier_details

  return NextResponse.json({
    onboarding: {
      org_id: onboarding.org_id,
      company_name: org?.name ?? `Carrier #${orgId}`,
      tier: details?.tier ?? 'starter',
      billing_status: details?.billing_status ?? 'trialing',
      contact_name: onboarding.contact_name,
      contact_email: onboarding.contact_email,
      stage: onboarding.stage,
      next_action: onboarding.next_action,
      next_follow_up_at: onboarding.next_follow_up_at,
      blocker_note: onboarding.blocker_note,
      owner_invite_sent_at: onboarding.owner_invite_sent_at,
      updated_at: onboarding.updated_at,
    },
    owner: owner ? {
      id: owner.id,
      name: [owner.first_name, owner.last_name].filter(Boolean).join(' ') || null,
      email: authUser?.email ?? onboarding.contact_email,
      confirmed_at: authUser?.confirmedAt ?? null,
      last_sign_in_at: authUser?.lastSignInAt ?? null,
    } : null,
    progress: {
      owner_invited: !!owner,
      owner_signed_in: !!authUser?.lastSignInAt,
      active_vehicles: vehicles.count ?? 0,
      active_drivers: drivers.count ?? 0,
      loads: loads.count ?? 0,
      invoices: invoices.count ?? 0,
      active_team_users: activeProfiles.length,
    },
    stages: STAGES,
  })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ org_id: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_support')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx
  const orgId = await parseOrgId((await params).org_id)
  if (!orgId) return apiError('VALIDATION_ERROR', 'Invalid carrier ID', 400)

  let body: unknown
  try { body = await request.json() } catch { return apiError('VALIDATION_ERROR', 'Invalid request body', 400) }
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const stage = input.stage
  const nextAction = input.next_action === null ? null : typeof input.next_action === 'string' ? input.next_action.trim() : undefined
  const blocker = input.blocker_note === null ? null : typeof input.blocker_note === 'string' ? input.blocker_note.trim() : undefined
  const followUp = input.next_follow_up_at === null ? null : typeof input.next_follow_up_at === 'string' ? input.next_follow_up_at : undefined
  if (typeof stage !== 'string' || !STAGES.includes(stage as typeof STAGES[number])) return apiError('VALIDATION_ERROR', 'Invalid onboarding stage', 400)
  if (nextAction === undefined || (nextAction !== null && nextAction.length > 500)) return apiError('VALIDATION_ERROR', 'Next action must be 500 characters or fewer', 400)
  if (blocker === undefined || (blocker !== null && blocker.length > 2000)) return apiError('VALIDATION_ERROR', 'Blocker note must be 2,000 characters or fewer', 400)
  if (followUp === undefined || (followUp !== null && (!Number.isFinite(Date.parse(followUp)) || new Date(followUp).toISOString() !== followUp))) return apiError('VALIDATION_ERROR', 'Invalid follow-up date', 400)

  const { data: updated, error } = await admin.from('admin_carrier_onboarding').update({
    stage,
    next_action: nextAction,
    blocker_note: blocker,
    next_follow_up_at: followUp,
  }).eq('org_id', orgId).select('org_id, stage, next_action, blocker_note, next_follow_up_at').maybeSingle()
  if (error || !updated) {
    if (error) logError({ route: 'admin/onboarding/:org_id PATCH', requestId: request.headers.get('x-request-id') }, error, { step: 'update' })
    return error ? apiError('SERVER_ERROR', 'Could not update onboarding case', 500) : apiError('NOT_FOUND', 'Onboarding case not found', 404)
  }
  const { error: auditError } = await admin.from('admin_events').insert({
    org_id: orgId,
    admin_id: userId,
    event_type: 'admin.carrier_onboarding_updated',
    metadata: { stage: updated.stage, next_action: updated.next_action, has_blocker: !!updated.blocker_note, next_follow_up_at: updated.next_follow_up_at },
  })
  if (auditError) logError({ route: 'admin/onboarding/:org_id PATCH', requestId: request.headers.get('x-request-id') }, auditError, { step: 'audit' })
  return NextResponse.json({ onboarding: updated })
}
