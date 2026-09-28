import { NextRequest, NextResponse } from 'next/server'
import { apiError, isErrorResponse } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { createAuthAdminProvider } from '@/lib/auth-admin'
import { logError } from '@/lib/observability'
import { getOrgUserForSupportAccess } from '@/lib/queries/profiles'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest, { params }: { params: Promise<{ session_id: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_impersonate')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx
  const sessionId = (await params).session_id
  if (!SESSION_ID.test(sessionId)) return apiError('VALIDATION_ERROR', 'Invalid support session', 400)

  const { data: found, error: sessionError } = await admin
    .from('admin_support_access_sessions')
    .select('id, admin_id, target_user_id, org_id, ticket_id, reason, started_at, expires_at, ended_at')
    .eq('id', sessionId)
    .eq('admin_id', userId)
    .maybeSingle()
  if (sessionError) {
    logError({ route: 'admin/support-sessions/:id', requestId: request.headers.get('x-request-id') }, sessionError, { step: 'lookup' })
    return apiError('SERVER_ERROR', 'Could not load support access', 500)
  }
  if (!found) return apiError('NOT_FOUND', 'Support session not found', 404)
  if (found.ended_at || new Date(found.expires_at).getTime() <= Date.now()) {
    return apiError('VALIDATION_ERROR', 'Support access has ended or expired', 410)
  }

  const now = new Date().toISOString()
  const { data: active, error: touchError } = await admin
    .from('admin_support_access_sessions')
    .update({ last_accessed_at: now })
    .eq('id', sessionId)
    .eq('admin_id', userId)
    .is('ended_at', null)
    .gt('expires_at', now)
    .select('id')
    .maybeSingle()
  if (touchError) {
    logError({ route: 'admin/support-sessions/:id', requestId: request.headers.get('x-request-id') }, touchError, { step: 'touch' })
    return apiError('SERVER_ERROR', 'Could not verify active support access', 500)
  }
  if (!active) return apiError('VALIDATION_ERROR', 'Support access has ended or expired', 410)

  const { data: target, error: targetError } = await getOrgUserForSupportAccess(admin, found.target_user_id, found.org_id)
  const { data: organization, error: orgError } = await admin
    .from('organizations')
    .select('id, name')
    .eq('id', found.org_id)
    .maybeSingle()
  if (targetError || orgError) {
    logError({ route: 'admin/support-sessions/:id', requestId: request.headers.get('x-request-id') }, targetError ?? orgError, { step: 'target_or_org' })
    return apiError('SERVER_ERROR', 'Could not load user support context', 500)
  }
  if (!target || !organization) return apiError('NOT_FOUND', 'User or carrier no longer exists', 404)

  const authAdmin = createAuthAdminProvider(admin)
  const { data: authData, error: authError } = await authAdmin.getUserById(target.id)
  const [ticketResult, recentTicketsResult] = await Promise.all([
    found.ticket_id
      ? admin.from('support_tickets')
          .select('id, category, related_load_number, body, status, created_at, updated_at')
          .eq('id', found.ticket_id)
          .eq('carrier_org_id', found.org_id)
          .eq('queue', 'carrieros_support')
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from('support_tickets')
      .select('id, category, related_load_number, status, created_at, updated_at')
      .eq('carrier_org_id', found.org_id)
      .eq('submitted_by', target.id)
      .eq('queue', 'carrieros_support')
      .order('created_at', { ascending: false })
      .limit(5),
  ])
  if (ticketResult.error || recentTicketsResult.error) {
    logError({ route: 'admin/support-sessions/:id', requestId: request.headers.get('x-request-id') }, ticketResult.error ?? recentTicketsResult.error, { step: 'ticket_context' })
    return apiError('SERVER_ERROR', 'Could not load support history', 500)
  }

  const messagesResult = ticketResult.data
    ? await admin.from('support_ticket_messages')
        .select('id, sender_id, body, is_ai_generated, created_at')
        .eq('ticket_id', ticketResult.data.id)
        .order('created_at', { ascending: true })
    : { data: [], error: null }
  if (messagesResult.error) {
    logError({ route: 'admin/support-sessions/:id', requestId: request.headers.get('x-request-id') }, messagesResult.error, { step: 'ticket_messages' })
    return apiError('SERVER_ERROR', 'Could not load support ticket conversation', 500)
  }

  const { error: auditError } = await admin.from('admin_events').insert({
    org_id: found.org_id,
    admin_id: userId,
    event_type: 'admin.support_access.viewed',
    metadata: { session_id: found.id, target_user_id: found.target_user_id, ticket_id: found.ticket_id },
  })
  if (auditError) {
    logError({ route: 'admin/support-sessions/:id', requestId: request.headers.get('x-request-id') }, auditError, { step: 'audit_view' })
    return apiError('SERVER_ERROR', 'Support context was not opened because its audit record could not be written', 500)
  }

  return NextResponse.json({
    session: { id: found.id, reason: found.reason, started_at: found.started_at, expires_at: found.expires_at },
    organization,
    user: {
      id: target.id,
      name: [target.first_name, target.last_name].filter(Boolean).join(' ') || null,
      role: target.role,
      is_active: target.is_active,
      created_at: target.created_at,
      email: authData?.user?.email ?? null,
      last_sign_in_at: authData?.user?.lastSignInAt ?? null,
      auth_account_found: authError ? null : !!authData?.user,
    },
    linked_ticket: ticketResult.data,
    linked_ticket_messages: messagesResult.data ?? [],
    recent_tickets: recentTicketsResult.data ?? [],
    scope: 'Read-only support context. This does not sign in as the user. Tenant actions and data outside the listed support context are not available in this session.',
  })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ session_id: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_impersonate')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx
  const sessionId = (await params).session_id
  if (!SESSION_ID.test(sessionId)) return apiError('VALIDATION_ERROR', 'Invalid support session', 400)

  const { data: session, error: endError } = await admin
    .from('admin_support_access_sessions')
    .update({ ended_at: new Date().toISOString(), ended_by: userId })
    .eq('id', sessionId)
    .eq('admin_id', userId)
    .is('ended_at', null)
    .select('id, org_id, target_user_id')
    .maybeSingle()
  if (endError) {
    logError({ route: 'admin/support-sessions/:id', requestId: request.headers.get('x-request-id') }, endError, { step: 'end' })
    return apiError('SERVER_ERROR', 'Could not end support access', 500)
  }
  if (!session) return apiError('NOT_FOUND', 'Active support session not found', 404)

  const { error: auditError } = await admin.from('admin_events').insert({
    org_id: session.org_id,
    admin_id: userId,
    event_type: 'admin.support_access.ended',
    metadata: { session_id: session.id, target_user_id: session.target_user_id },
  })
  if (auditError) {
    logError({ route: 'admin/support-sessions/:id', requestId: request.headers.get('x-request-id') }, auditError, { step: 'audit_end' })
    return apiError('SERVER_ERROR', 'Support access ended, but its audit record could not be written', 500, { session_ended: true })
  }
  return new NextResponse(null, { status: 204 })
}
