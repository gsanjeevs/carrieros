// POST /api/v1/loads/{id}/ifta-crossings — record a GPS state crossing. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createIftaService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { RecordCrossingBodySchema, RecordCrossingResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, RecordCrossingBodySchema)
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createIftaService(cmd.supabase).recordGpsCrossing(
    cmd.actor,
    cmd.id,
    { state: cmd.body.state, crossedAt: new Date(cmd.body.crossed_at), latitude: cmd.body.latitude, longitude: cmd.body.longitude },
    cmd.idempotencyKey
  )
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id]/ifta-crossings POST', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(RecordCrossingResponseSchema.parse({ id: result.value.id }))
}
