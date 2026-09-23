// POST /api/v1/loads/{id}/expenses — log an expense (toll/lumper/scale/other)
// against a load. Transport only: parse, authenticate, delegate. First write
// path for load_expenses (T19 accounting-integration readiness layer).
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createLoadExpenseService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { RecordLoadExpenseBodySchema, RecordLoadExpenseResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, RecordLoadExpenseBodySchema)
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createLoadExpenseService(cmd.supabase).recordExpense(
    cmd.actor,
    cmd.id,
    { expenseType: cmd.body.expense_type, amount: cmd.body.amount, note: cmd.body.note },
    cmd.idempotencyKey
  )
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id]/expenses POST', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(RecordLoadExpenseResponseSchema.parse({ id: result.value.id, amount: result.value.amount }))
}
