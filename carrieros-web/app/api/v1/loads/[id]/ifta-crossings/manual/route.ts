// PUT /api/v1/loads/{id}/ifta-crossings/manual — replace GPS crossings with manual mileage, atomically.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createIftaService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { ManualCrossingsBodySchema, ManualCrossingsResponseSchema } from '@/server/contract/schemas'

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, ManualCrossingsBodySchema, { requireIdempotencyKey: false })
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createIftaService(cmd.supabase).replaceWithManual(cmd.actor, cmd.id, cmd.body.rows)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id]/ifta-crossings/manual PUT', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(ManualCrossingsResponseSchema.parse({ written: result.value.written }))
}
