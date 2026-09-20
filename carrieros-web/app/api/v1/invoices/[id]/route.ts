// PATCH /api/v1/invoices/{id} — edit a DRAFT invoice. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createInvoiceService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { UpdateInvoiceBodySchema, UpdateInvoiceResponseSchema } from '@/server/contract/schemas'

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
