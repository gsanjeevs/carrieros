// app/api/support/tickets/[id]/route.ts
// GET: ticket + its message thread, for the submitter (own ticket) OR org_support staff (their org's
// org_support-queue tickets) — RLS (support_tickets/support_ticket_messages SELECT policies,
// migration 0027) is what actually decides which of those two applies; this route just runs both
// queries through the caller's session client and lets RLS filter.
// PATCH: status change (resolve/close) — org_support staff only, same RLS-enforced boundary.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { logError } from '@/lib/observability'

const VALID_STATUSES = ['open', 'resolved', 'closed'] as const

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const ticketId = Number((await params).id)
  if (!Number.isInteger(ticketId)) return apiError('VALIDATION_ERROR', 'Invalid ticket id', 400)

  const { data: ticket, error: ticketErr } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('id', ticketId)
    .maybeSingle()

  if (ticketErr) {
    logError({ route: 'api/support/tickets/:id', requestId: request.headers.get('x-request-id'), userId: user.id }, ticketErr, { step: 'fetch_ticket' })
    return apiError('SERVER_ERROR', ticketErr.message, 500)
  }
  if (!ticket) return apiError('NOT_FOUND', 'Ticket not found', 404)

  const { data: messages, error: messagesErr } = await supabase
    .from('support_ticket_messages')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })

  if (messagesErr) {
    logError({ route: 'api/support/tickets/:id', requestId: request.headers.get('x-request-id'), userId: user.id }, messagesErr, { step: 'fetch_messages' })
    return apiError('SERVER_ERROR', messagesErr.message, 500)
  }

  return NextResponse.json({ ticket, messages: messages ?? [] })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

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

  const { data: updated, error } = await supabase
    .from('support_tickets')
    .update({
      status,
      resolved_at: status === 'resolved' || status === 'closed' ? new Date().toISOString() : null,
    })
    .eq('id', ticketId)
    .select('*')
    .maybeSingle()

  if (error) {
    logError({ route: 'api/support/tickets/:id', requestId: request.headers.get('x-request-id'), userId: user.id }, error, { step: 'update_status' })
    return apiError('SERVER_ERROR', error.message, 500)
  }
  // RLS silently filters an update the caller isn't allowed to make -- 0 rows, no error -- so a null
  // result here means either "not found" or "not yours to update"; NOT_FOUND either way (same
  // no-existence-leak posture other routes in this codebase use).
  if (!updated) return apiError('NOT_FOUND', 'Ticket not found', 404)

  return NextResponse.json({ ticket: updated })
}
