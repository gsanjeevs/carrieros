// app/api/admin/support-tickets/[id]/route.ts
// ShipmentX admin console — carrieros_support-queue ticket detail + status update (decisions.md T16,
// resolving PR1's "dedicated support"). Uses the service-role admin client per lib/admin-auth.ts's
// established convention (every /api/admin/** route does its cross-tenant reads this way, never
// through the sx_* staff member's own session client) — the RLS policies migration 0027 also grants
// sx_owner/sx_support directly on support_tickets are defense in depth, not the primary boundary here.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

const VALID_STATUSES = ['open', 'resolved', 'closed'] as const

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_support')
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const ticketId = Number((await params).id)
  if (!Number.isInteger(ticketId)) return apiError('VALIDATION_ERROR', 'Invalid ticket id', 400)

  const { data: ticket, error: ticketErr } = await admin
    .from('support_tickets')
    .select('*, organizations!support_tickets_carrier_org_id_fkey(name)')
    .eq('id', ticketId)
    .eq('queue', 'carrieros_support')
    .maybeSingle()

  if (ticketErr) {
    logError({ route: 'admin/support-tickets/:id', requestId: request.headers.get('x-request-id') }, ticketErr, { step: 'fetch_ticket' })
    return apiError('SERVER_ERROR', ticketErr.message, 500)
  }
  if (!ticket) return apiError('NOT_FOUND', 'Ticket not found', 404)

  const { data: messages, error: messagesErr } = await admin
    .from('support_ticket_messages')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })

  if (messagesErr) {
    logError({ route: 'admin/support-tickets/:id', requestId: request.headers.get('x-request-id') }, messagesErr, { step: 'fetch_messages' })
    return apiError('SERVER_ERROR', messagesErr.message, 500)
  }

  return NextResponse.json({ ticket, messages: messages ?? [] })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const status = (body as { status?: unknown }).status
  if (typeof status !== 'string' || !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return apiError('VALIDATION_ERROR', 'A valid status is required', 400)
  }

  const { data: updated, error } = await admin
    .from('support_tickets')
    .update({
      status,
      resolved_at: status === 'resolved' || status === 'closed' ? new Date().toISOString() : null,
    })
    .eq('id', ticketId)
    .eq('queue', 'carrieros_support')
    .select('*')
    .maybeSingle()

  if (error) {
    logError({ route: 'admin/support-tickets/:id', requestId: request.headers.get('x-request-id') }, error, { step: 'update_status' })
    return apiError('SERVER_ERROR', error.message, 500)
  }
  if (!updated) return apiError('NOT_FOUND', 'Ticket not found', 404)

  await admin.from('admin_events').insert({
    org_id: updated.carrier_org_id,
    admin_id: userId,
    event_type: 'admin.support_ticket_status',
    metadata: { ticket_id: ticketId, status },
  })

  return NextResponse.json({ ticket: updated })
}
