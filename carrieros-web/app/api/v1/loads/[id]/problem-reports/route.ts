// POST /api/v1/loads/{id}/problem-reports — a driver reports a problem/delay; it
// lands in the Exceptions inbox. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createDriverActionService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { ReportProblemBodySchema, ReportProblemResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, ReportProblemBodySchema)
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createDriverActionService(cmd.supabase).reportProblem(
    cmd.actor,
    cmd.id,
    { reason: cmd.body.reason, note: cmd.body.note },
    cmd.idempotencyKey
  )
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id]/problem-reports POST', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(ReportProblemResponseSchema.parse({ id: result.value.id }))
}
