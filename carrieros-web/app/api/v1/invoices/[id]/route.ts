// GET/PATCH /api/v1/invoices/{id} — read, or edit a DRAFT invoice. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createInvoiceQueryService, createInvoiceService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { InvoiceDetailResponseSchema, InvoiceIdParamsSchema, UpdateInvoiceBodySchema, UpdateInvoiceResponseSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = InvoiceIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid id', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createInvoiceQueryService(authed.supabase).getDetail(actor.value, params.data.id)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/invoices/[id] GET', requestId, userId: authed.user.id }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(InvoiceDetailResponseSchema.parse(result.value))
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, UpdateInvoiceBodySchema, { requireIdempotencyKey: false })
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createInvoiceService(cmd.supabase).updateDraft(cmd.actor, cmd.id, {
    amount: cmd.body.amount,
    dueDate: cmd.body.due_date,
    notes: cmd.body.notes,
  })
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/invoices/[id] PATCH', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(UpdateInvoiceResponseSchema.parse({ id: result.value.id }))
}
