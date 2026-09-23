// POST /api/v1/loads/{id}/messages/read — transport only; rules live in FieldActionsService.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createFieldActionsService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { MarkMessagesReadBodySchema, MarkMessagesReadResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, MarkMessagesReadBodySchema, { requireIdempotencyKey: false })
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createFieldActionsService(cmd.supabase).markMessagesRead(cmd.actor, cmd.id, cmd.body.message_ids)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'POST /api/v1/loads/{id}/messages/read', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(MarkMessagesReadResponseSchema.parse({ updated: result.value.updated }))
}
