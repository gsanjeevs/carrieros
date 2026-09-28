import { NextRequest, NextResponse } from 'next/server'
import { apiError, isErrorResponse } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { createAuthAdminProvider } from '@/lib/auth-admin'
import { getOrgUserAccessProfile } from '@/lib/queries/profiles'
import { logError } from '@/lib/observability'

export async function GET(request: NextRequest, { params }: { params: Promise<{ org_id: string; user_id: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_support')
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const { org_id: rawOrgId, user_id: userId } = await params
  const orgId = Number(rawOrgId)
  if (!Number.isSafeInteger(orgId) || orgId <= 0 || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return apiError('VALIDATION_ERROR', 'Invalid carrier or user identifier', 400)
  }

  const { data: profile, error: profileError } = await getOrgUserAccessProfile(admin, userId, orgId)
  if (profileError) {
    logError({ route: 'admin/orgs/:org_id/users/:user_id', requestId: request.headers.get('x-request-id') }, profileError, { step: 'profile' })
    return apiError('SERVER_ERROR', 'Could not load carrier user', 500)
  }
  if (!profile) return apiError('NOT_FOUND', 'Carrier user not found', 404)

  const authProvider = createAuthAdminProvider(admin)
  const [authResult, activityResult, legacyAuditResult, accessResult, ticketsResult] = await Promise.all([
    authProvider.getUserById(userId),
    admin.from('tenant_activity_events')
      .select('id, action, aggregate_type, aggregate_id, operation, occurred_at')
      .eq('org_id', orgId).eq('actor_user_id', userId)
      .order('occurred_at', { ascending: false }).limit(100),
    admin.from('audit_events')
      .select('id, action, aggregate_type, aggregate_id, prior_state, new_state, reason, occurred_at')
      .eq('org_id', orgId).eq('actor_user_id', userId)
      .order('occurred_at', { ascending: false }).limit(100),
    admin.from('admin_support_access_sessions')
      .select('id, ticket_id, reason, started_at, expires_at, ended_at, ended_by')
      .eq('org_id', orgId).eq('target_user_id', userId)
      .order('started_at', { ascending: false }).limit(50),
    admin.from('support_tickets')
      .select('id, category, status, created_at, updated_at')
      .eq('carrier_org_id', orgId).eq('submitted_by', userId).eq('queue', 'carrieros_support')
      .order('created_at', { ascending: false }).limit(50),
  ])

  const queryError = activityResult.error ?? legacyAuditResult.error ?? accessResult.error ?? ticketsResult.error
  if ((authResult.error && authResult.error.status !== 404) || queryError) {
    const failure = authResult.error?.status === 404 ? queryError : authResult.error ?? queryError
    logError({ route: 'admin/orgs/:org_id/users/:user_id', requestId: request.headers.get('x-request-id') }, failure, { step: 'history' })
    return apiError('SERVER_ERROR', 'Could not load user access history', 500)
  }

  const auth = authResult.error?.status === 404 ? null : authResult.data?.user ?? null
  return NextResponse.json({
    user: {
      id: profile.id,
      name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || null,
      email: auth?.email ?? null,
      phone: profile.phone,
      role: profile.role,
      is_active: profile.is_active,
      auth_account_exists: auth !== null,
      auth_created_at: auth?.createdAt ?? null,
      confirmed_at: auth?.confirmedAt ?? null,
      last_sign_in_at: auth?.lastSignInAt ?? null,
      banned_until: auth?.bannedUntil ?? null,
      is_anonymous: auth?.isAnonymous ?? false,
    },
    activity: activityResult.data ?? [],
    legacy_audit_events: legacyAuditResult.data ?? [],
    support_access_sessions: accessResult.data ?? [],
    support_tickets: ticketsResult.data ?? [],
    coverage: {
      tenant_writes: 'Selected database writes are recorded without row payloads.',
      not_recorded: ['read-only actions', 'failed requests', 'auth session/IP/device history', 'writes performed by service-role jobs without a user identity'],
    },
  })
}
