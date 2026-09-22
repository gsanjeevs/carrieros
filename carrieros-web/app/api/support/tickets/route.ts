// app/api/support/tickets/route.ts
// In-app support ticketing (decisions.md T16). POST creates a ticket for the caller: fetches their
// own identity/org/tier context automatically (never asks the user to self-report it), runs the AI
// triage classification (lib/support-triage.ts, same claude-haiku-4-5 pattern as
// app/api/extract-load/route.ts), then inserts the ticket via the caller's OWN session client so the
// existing RLS INSERT policy (submitted_by = auth.uid() AND carrier_org_id = my_org_id()) is the real
// enforcement, not just app-layer trust. GET lists the caller's own tickets (RLS-filtered).
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'
import { hasFeature } from '@/lib/entitlements'
import {
  classifySupportTicket, TriageFailedError,
  type SupportCategory,
} from '@/lib/support-triage'
import { logError } from '@/lib/observability'

const VALID_CATEGORIES: SupportCategory[] = [
  'technical_issue', 'load_dispatch', 'account_billing', 'compliance_safety', 'driver_pay_hr', 'feature_request', 'other',
]

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'Finish setting up your account first.', 403)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400)
  }
  const input = body as { category?: unknown; body?: unknown; related_load_number?: unknown }

  const category = input.category as SupportCategory
  if (!VALID_CATEGORIES.includes(category)) {
    return apiError('VALIDATION_ERROR', 'A valid category is required', 400)
  }
  const ticketBody = typeof input.body === 'string' ? input.body.trim() : ''
  if (ticketBody.length < 10) {
    return apiError('VALIDATION_ERROR', 'Please describe your question or issue (at least 10 characters)', 400)
  }
  const relatedLoadNumber = typeof input.related_load_number === 'string' && input.related_load_number.trim()
    ? input.related_load_number.trim()
    : null

  // Identity/context captured automatically (T16: "record details about them... ask the right
  // question", never a self-reported field) — snapshotted onto the row so later role/tier changes
  // don't rewrite ticket history.
  const [{ data: carrierDetails }, orgSupportEligible] = await Promise.all([
    supabase.from('carrier_details').select('tier').eq('org_id', profile.org_id).maybeSingle(),
    hasFeature(supabase, 'support_desk'),
  ])

  const logContext = { route: 'api/support/tickets', requestId: request.headers.get('x-request-id'), userId: user.id, orgId: profile.org_id }

  let triage
  try {
    triage = await classifySupportTicket(
      {
        category,
        body: ticketBody,
        relatedLoadNumber,
        submitterRole: profile.role,
        orgSupportEligible,
      },
      logContext
    )
  } catch (err) {
    if (err instanceof TriageFailedError) {
      return apiError('TRIAGE_FAILED', err.message, err.status ?? 500)
    }
    throw err
  }

  const { data: ticket, error: insertErr } = await supabase
    .from('support_tickets')
    .insert({
      submitted_by: user.id,
      carrier_org_id: profile.org_id,
      submitter_role: profile.role,
      submitter_tier: carrierDetails?.tier ?? null,
      category,
      related_load_number: relatedLoadNumber,
      body: ticketBody,
      queue: triage.queue,
      fallback_queue: triage.queue === 'ai_resolved' ? triage.targetQueue : null,
      status: triage.queue === 'ai_resolved' ? 'resolved' : 'open',
      ai_confidence: triage.confidence,
      ai_answer: triage.autoAnswer,
      resolved_at: triage.queue === 'ai_resolved' ? new Date().toISOString() : null,
    })
    .select('*')
    .single()

  if (insertErr || !ticket) {
    logError(logContext, insertErr, { step: 'insert_ticket' })
    return apiError('SERVER_ERROR', insertErr?.message ?? 'Could not create ticket', 500)
  }

  // Mirror the auto-answer into the thread so submit + fetch-detail always shows a consistent
  // conversation, whether the ticket was auto-resolved or not.
  if (triage.queue === 'ai_resolved' && triage.autoAnswer) {
    await supabase.from('support_ticket_messages').insert({
      ticket_id: ticket.id,
      carrier_org_id: profile.org_id,
      sender_id: null,
      is_ai_generated: true,
      body: triage.autoAnswer,
    })
  }

  return NextResponse.json({ ticket }, { status: 201 })
}

export async function GET(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: tickets, error } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('submitted_by', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    logError({ route: 'api/support/tickets', requestId: request.headers.get('x-request-id'), userId: user.id }, error, { step: 'list' })
    return apiError('SERVER_ERROR', error.message, 500)
  }

  return NextResponse.json({ tickets: tickets ?? [] })
}
