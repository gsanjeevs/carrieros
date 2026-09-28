import { NextRequest, NextResponse } from 'next/server'
import { apiError, isErrorResponse } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'
import { getOrgUserForSupportAccess } from '@/lib/queries/profiles'

export async function POST(request: NextRequest, { params }: { params: Promise<{ org_id: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_impersonate')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const orgId = Number((await params).org_id)
  if (!Number.isSafeInteger(orgId) || orgId <= 0) return apiError('VALIDATION_ERROR', 'Invalid carrier organization', 400)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400)
  }

  const input = body && typeof body === 'object'
    ? body as { target_user_id?: unknown; reason?: unknown; ticket_id?: unknown }
    : {}
  const targetUserId = typeof input.target_user_id === 'string' ? input.target_user_id : ''
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  const ticketId = input.ticket_id == null || input.ticket_id === '' ? null : Number(input.ticket_id)
  if (!targetUserId) return apiError('VALIDATION_ERROR', 'A target user is required', 400)
  if (reason.length < 10 || reason.length > 500) return apiError('VALIDATION_ERROR', 'Enter a support reason between 10 and 500 characters', 400)
  if (ticketId !== null && (!Number.isSafeInteger(ticketId) || ticketId <= 0)) {
    return apiError('VALIDATION_ERROR', 'Ticket ID must be a positive integer', 400)
  }

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .eq('type', 'carrier')
    .maybeSingle()
  if (orgError) {
    logError({ route: 'admin/orgs/:id/support-sessions', requestId: request.headers.get('x-request-id') }, orgError, { step: 'validate_org' })
    return apiError('SERVER_ERROR', 'Could not verify carrier organization', 500)
  }
  if (!org) return apiError('NOT_FOUND', 'Carrier organization not found', 404)

  const { data: target, error: targetError } = await getOrgUserForSupportAccess(admin, targetUserId, orgId)
  if (targetError) {
    logError({ route: 'admin/orgs/:id/support-sessions', requestId: request.headers.get('x-request-id') }, targetError, { step: 'validate_target' })
    return apiError('SERVER_ERROR', 'Could not verify target user', 500)
  }
  if (!target) return apiError('NOT_FOUND', 'User does not belong to this carrier', 404)

  if (ticketId !== null) {
    const { data: ticket, error: ticketError } = await admin
      .from('support_tickets')
      .select('id')
      .eq('id', ticketId)
      .eq('carrier_org_id', orgId)
      .eq('queue', 'carrieros_support')
      .maybeSingle()
    if (ticketError) {
      logError({ route: 'admin/orgs/:id/support-sessions', requestId: request.headers.get('x-request-id') }, ticketError, { step: 'validate_ticket' })
      return apiError('SERVER_ERROR', 'Could not verify support ticket', 500)
    }
    if (!ticket) return apiError('VALIDATION_ERROR', 'Ticket must belong to this carrier and the CarrierOS support queue', 400)
  }

  const { data: session, error: sessionError } = await admin
    .from('admin_support_access_sessions')
    .insert({
      admin_id: userId,
      target_user_id: targetUserId,
      org_id: orgId,
      ticket_id: ticketId,
      reason,
    })
    .select('id, expires_at')
    .single()

  if (sessionError || !session) {
    logError({ route: 'admin/orgs/:id/support-sessions', requestId: request.headers.get('x-request-id') }, sessionError, { step: 'create_session' })
    return apiError('SERVER_ERROR', 'Could not start support access', 500)
  }

  const { error: auditError } = await admin.from('admin_events').insert({
    org_id: orgId,
    admin_id: userId,
    event_type: 'admin.support_access.started',
    metadata: {
      session_id: session.id,
      target_user_id: targetUserId,
      ticket_id: ticketId,
      reason,
      expires_at: session.expires_at,
    },
  })

  if (auditError) {
    await admin
      .from('admin_support_access_sessions')
      .update({ ended_at: new Date().toISOString(), ended_by: userId })
      .eq('id', session.id)
      .eq('admin_id', userId)
    logError({ route: 'admin/orgs/:id/support-sessions', requestId: request.headers.get('x-request-id') }, auditError, { step: 'audit_start' })
    return apiError('SERVER_ERROR', 'Support access was not opened because its audit record could not be written', 500)
  }

  return NextResponse.json({ session: { id: session.id, expires_at: session.expires_at, org_id: orgId } }, { status: 201 })
}
