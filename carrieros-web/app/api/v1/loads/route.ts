// GET /api/v1/loads — list loads visible to the caller.
// Transport only: authenticate, build the actor from the verified session,
// validate the query against the contract, delegate to the application service,
// map the result. Used by mobile and by web client code; the web list page calls
// the same LoadQueryService in-process.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createLoadQueryService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { ListLoadsQuerySchema, ListLoadsResponseSchema } from '@/server/contract/schemas'
import type { LoadStatusGroup } from '@/server/domain/load/status-groups'

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = request.nextUrl.searchParams
  const parsed = ListLoadsQuerySchema.safeParse({
    status_group: params.get('status_group') ?? undefined,
    limit: params.has('limit') ? Number(params.get('limit')) : undefined,
  })
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid query', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createLoadQueryService(authed.supabase).list(actor.value, {
    statusGroups: parsed.data.status_group?.split(',') as LoadStatusGroup[] | undefined,
    limit: parsed.data.limit,
  })
  if (!result.ok) {
    logError({ route: 'api/v1/loads GET', requestId, userId: authed.user.id }, result.error.detail)
    return domainErrorResponse(result.error)
  }

  // Parse our own output against the contract: the schema is the promise, and
  // this makes a violation (e.g. a stray `rate`) fail loudly instead of leaking.
  const body = ListLoadsResponseSchema.parse({
    loads: result.value.loads,
    can_see_rate: result.value.canSeeRate,
  })
  return NextResponse.json(body)
}
