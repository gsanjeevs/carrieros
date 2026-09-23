// GET /api/v1/loads/{id} — a single load, with its timeline, visible to the caller.
// Transport only: same LoadQueryService the /api/v1/loads list and the web load
// list page use, so tenant scoping, driver restriction and rate visibility are
// decided in one place.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createLoadQueryService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { GetLoadResponseSchema, LoadIdParamsSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = LoadIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid id', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createLoadQueryService(authed.supabase).getDetail(actor.value, params.data.id)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id] GET', requestId, userId: authed.user.id }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }

  const body = GetLoadResponseSchema.parse({ load: result.value.load, events: result.value.events })
  return NextResponse.json(body)
}
