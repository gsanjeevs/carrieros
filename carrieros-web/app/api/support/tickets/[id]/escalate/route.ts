// app/api/support/tickets/[id]/escalate/route.ts
// "Still need help?" on an ai_resolved ticket (decisions.md T16: never a dead end). Calls the
// escalate_support_ticket() RPC (migration 0027), which owns the actual state-transition rules
// (ownership check, queue/status validation) — this route is a thin pass-through, same shape as any
// other RPC-backed write in this codebase (e.g. submit_dvir_inspection).
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { logError } from '@/lib/observability'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const ticketId = Number((await params).id)
  if (!Number.isInteger(ticketId)) return apiError('VALIDATION_ERROR', 'Invalid ticket id', 400)

  const { data, error } = await supabase.rpc('escalate_support_ticket', { p_ticket_id: ticketId })

  if (error) {
    logError({ route: 'api/support/tickets/:id/escalate', requestId: request.headers.get('x-request-id'), userId: user.id }, error, { step: 'rpc' })
    if (error.code === 'P0002') return apiError('NOT_FOUND', 'Ticket not found', 404)
    if (error.code === '22023') return apiError('NOT_ELIGIBLE', 'This ticket is not eligible for escalation.', 409)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  return NextResponse.json({ ticket: data })
}
