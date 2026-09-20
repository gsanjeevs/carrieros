// POST /api/v1/loads/{id}/dvir-inspections — file a DVIR (inspection + defects, atomically). Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createDvirService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { SubmitDvirBodySchema, SubmitDvirResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, SubmitDvirBodySchema)
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createDvirService(cmd.supabase).submit(cmd.actor, cmd.id, cmd.body, cmd.idempotencyKey)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id]/dvir-inspections POST', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(SubmitDvirResponseSchema.parse({ id: result.value.id, defects: result.value.defects }))
}
