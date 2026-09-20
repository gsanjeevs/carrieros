// POST /api/v1/loads/{id}/documents (finalize an upload) and
// GET  /api/v1/loads/{id}/documents?type= (list with signed download URLs). Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createDocumentService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { parseLoadCommand } from '@/server/http-command'
import {
  DocumentResponseSchema,
  FinalizeDocumentBodySchema,
  ListDocumentsQuerySchema,
  ListDocumentsResponseSchema,
  LoadIdParamsSchema,
} from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseLoadCommand(request, context, FinalizeDocumentBodySchema)
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createDocumentService(cmd.supabase).finalize(
    cmd.actor,
    cmd.loadId,
    { type: cmd.body.type, storagePath: cmd.body.storage_path },
    cmd.idempotencyKey
  )
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id]/documents POST', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(DocumentResponseSchema.parse({ id: result.value.id, type: result.value.type, storage_path: result.value.storagePath }))
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = LoadIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid load id', 400)
  const query = ListDocumentsQuerySchema.safeParse({ type: request.nextUrl.searchParams.get('type') ?? undefined })
  if (!query.success) return apiError('VALIDATION_ERROR', query.error.issues[0]?.message ?? 'Invalid query', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createDocumentService(authed.supabase).list(actor.value, params.data.id, query.data.type)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id]/documents GET', requestId, userId: authed.user.id }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(
    ListDocumentsResponseSchema.parse({
      documents: result.value.map((d) => ({ id: d.id, type: d.type, created_at: d.createdAt, url: d.url })),
    })
  )
}
