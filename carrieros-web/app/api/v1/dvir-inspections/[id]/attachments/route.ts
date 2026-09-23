// POST /api/v1/dvir-inspections/{id}/attachments — step 3: verify the upload and attach it. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createDvirService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { FinalizeAttachmentBodySchema, OkResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, FinalizeAttachmentBodySchema)
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createDvirService(cmd.supabase).finalizeAttachment(
    cmd.actor,
    cmd.id,
    { kind: cmd.body.kind, area: cmd.body.area, storagePath: cmd.body.storage_path },
    cmd.idempotencyKey
  )
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/dvir-inspections/[id]/attachments POST', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(OkResponseSchema.parse({ ok: true }))
}
