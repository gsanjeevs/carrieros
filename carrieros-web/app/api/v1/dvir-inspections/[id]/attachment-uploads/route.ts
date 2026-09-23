// POST /api/v1/dvir-inspections/{id}/attachment-uploads — step 1: server-chosen path + signed upload URL.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createDvirService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { RequestAttachmentBodySchema, RequestUploadResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, RequestAttachmentBodySchema, { requireIdempotencyKey: false })
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createDvirService(cmd.supabase).requestAttachmentUpload(cmd.actor, cmd.id, {
    kind: cmd.body.kind,
    area: cmd.body.area,
    contentType: cmd.body.content_type,
  })
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/dvir-inspections/[id]/attachment-uploads POST', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(RequestUploadResponseSchema.parse({ upload_url: result.value.uploadUrl, storage_path: result.value.storagePath, content_type: result.value.contentType }))
}
