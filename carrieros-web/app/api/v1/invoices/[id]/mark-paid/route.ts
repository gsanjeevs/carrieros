// POST /api/v1/invoices/{id}/mark-paid — invoice paid + its load paid, atomically; idempotent by nature.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { z } from 'zod'
import { createInvoiceService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { MarkPaidResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, z.object({}), { requireIdempotencyKey: false, bodyOptional: true })
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createInvoiceService(cmd.supabase).markPaid(cmd.actor, cmd.id)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/invoices/[id]/mark-paid POST', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(MarkPaidResponseSchema.parse({ outcome: result.value.outcome, invoice_id: result.value.invoiceId }))
}
