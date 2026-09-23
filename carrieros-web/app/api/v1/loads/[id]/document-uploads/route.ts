// POST /api/v1/loads/{id}/document-uploads — step 1 of an upload: the server picks
// the storage path and returns a signed URL to PUT the bytes to. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createDocumentService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { RequestUploadBodySchema, RequestUploadResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, RequestUploadBodySchema, { requireIdempotencyKey: false })
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createDocumentService(cmd.supabase).requestUpload(cmd.actor, cmd.id, {
    type: cmd.body.type,
    contentType: cmd.body.content_type,
  })
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id]/document-uploads POST', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(
    RequestUploadResponseSchema.parse({
      upload_url: result.value.uploadUrl,
      storage_path: result.value.storagePath,
      content_type: result.value.contentType,
    })
  )
}
