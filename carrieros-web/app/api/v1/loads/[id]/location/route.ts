// PUT /api/v1/loads/{id}/location — transport only; rules live in FieldActionsService.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createFieldActionsService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { ShareLocationBodySchema, OkResponseSchema } from '@/server/contract/schemas'

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, ShareLocationBodySchema, { requireIdempotencyKey: false })
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createFieldActionsService(cmd.supabase).shareLocation(cmd.actor, cmd.id, { latitude: cmd.body.latitude, longitude: cmd.body.longitude, recordedAt: cmd.body.recorded_at ? new Date(cmd.body.recorded_at) : undefined })
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'PUT /api/v1/loads/{id}/location', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(OkResponseSchema.parse({ ok: true }))
}
