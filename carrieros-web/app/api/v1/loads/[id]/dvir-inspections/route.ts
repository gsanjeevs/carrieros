// GET/POST /api/v1/loads/{id}/dvir-inspections — list, or file, a DVIR (inspection + defects,
// atomically). Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createDvirQueryService, createDvirService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import {
  ListLoadDvirInspectionsQuerySchema,
  ListLoadDvirInspectionsResponseSchema,
  LoadIdParamsSchema,
  SubmitDvirBodySchema,
  SubmitDvirResponseSchema,
} from '@/server/contract/schemas'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = LoadIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid id', 400)

  const query = ListLoadDvirInspectionsQuerySchema.safeParse({ type: request.nextUrl.searchParams.get('type') ?? undefined })
  if (!query.success) return apiError('VALIDATION_ERROR', query.error.issues[0]?.message ?? 'Invalid query', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createDvirQueryService(authed.supabase).listForLoad(actor.value, params.data.id, query.data.type)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id]/dvir-inspections GET', requestId, userId: authed.user.id }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(ListLoadDvirInspectionsResponseSchema.parse({ inspections: result.value }))
}

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
