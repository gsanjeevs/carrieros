// app/api/admin/support-tickets/[id]/reply/route.ts
// ShipmentX staff reply to a carrieros_support-queue ticket. Service-role admin client, per
// lib/admin-auth.ts convention -- same reasoning as the sibling route.ts in this directory.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_support')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const ticketId = Number((await params).id)
  if (!Number.isInteger(ticketId)) return apiError('VALIDATION_ERROR', 'Invalid ticket id', 400)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400)
  }
  const messageBody = typeof (body as { body?: unknown }).body === 'string' ? (body as { body: string }).body.trim() : ''
  if (!messageBody) return apiError('VALIDATION_ERROR', 'A non-empty message is required', 400)
  if (messageBody.length > 10_000) return apiError('VALIDATION_ERROR', 'Message must be 10,000 characters or fewer', 400)

  const { data: ticket, error: ticketErr } = await admin
    .from('support_tickets')
    .select('id, carrier_org_id, queue')
    .eq('id', ticketId)
    .eq('queue', 'carrieros_support')
    .maybeSingle()

  if (ticketErr) {
    logError({ route: 'admin/support-tickets/:id/reply', requestId: request.headers.get('x-request-id') }, ticketErr, { step: 'fetch_ticket' })
    return apiError('SERVER_ERROR', ticketErr.message, 500)
  }
  if (!ticket) return apiError('NOT_FOUND', 'Ticket not found', 404)

  const { data: message, error } = await admin
    .from('support_ticket_messages')
    .insert({
      ticket_id: ticketId,
      carrier_org_id: ticket.carrier_org_id,
      sender_id: userId,
      is_ai_generated: false,
      body: messageBody,
    })
    .select('*')
    .single()

  if (error) {
    logError({ route: 'admin/support-tickets/:id/reply', requestId: request.headers.get('x-request-id') }, error, { step: 'insert' })
    return apiError('SERVER_ERROR', error.message, 500)
  }

  // Record who replied without copying support-message content into the administrative audit log.
  const { error: auditError } = await admin.from('admin_events').insert({
    org_id: ticket.carrier_org_id,
    admin_id: userId,
    event_type: 'admin.support_ticket_reply',
    metadata: { ticket_id: ticketId, message_id: message.id },
  })
  if (auditError) {
    logError({ route: 'admin/support-tickets/:id/reply', requestId: request.headers.get('x-request-id') }, auditError, { step: 'audit_reply' })
  }

  return NextResponse.json({ message }, { status: 201 })
}
