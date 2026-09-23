// app/api/support/tickets/[id]/reply/route.ts
// Post a reply into a ticket's thread — submitter (their own ticket) or org_support staff (their
// org's org_support-queue ticket). RLS on support_ticket_messages (migration 0027) is the actual
// boundary; the insert itself runs through the caller's session client.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'
import { logError } from '@/lib/observability'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const ticketId = Number((await params).id)
  if (!Number.isInteger(ticketId)) return apiError('VALIDATION_ERROR', 'Invalid ticket id', 400)

  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'Finish setting up your account first.', 403)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400)
  }
  const messageBody = typeof (body as { body?: unknown }).body === 'string' ? (body as { body: string }).body.trim() : ''
  if (!messageBody) return apiError('VALIDATION_ERROR', 'A non-empty message is required', 400)

  const { data: message, error } = await supabase
    .from('support_ticket_messages')
    .insert({
      ticket_id: ticketId,
      carrier_org_id: profile.org_id,
      sender_id: user.id,
      is_ai_generated: false,
      body: messageBody,
    })
    .select('*')
    .single()

  if (error) {
    logError({ route: 'api/support/tickets/:id/reply', requestId: request.headers.get('x-request-id'), userId: user.id }, error, { step: 'insert' })
    // RLS denial surfaces as a Postgres error here (INSERT ... WITH CHECK failure), not a silent
    // empty result the way SELECT/UPDATE do -- FORBIDDEN is the accurate code for that case.
    return apiError('FORBIDDEN', "You don't have permission to reply to this ticket.", 403)
  }

  return NextResponse.json({ message }, { status: 201 })
}
