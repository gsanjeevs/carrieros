// GET /api/public/v1/loads/{id} — a single load, with its timeline, for the
// public developer API. Reuses the SAME LoadQueryService as the internal
// /api/v1/loads/{id} route: another org's client requesting this id gets the
// identical 404 a same-org-but-wrong-role internal caller would (the query
// is scoped by actor.orgId; a row belonging to a different org simply isn't
// found) — never a 403 that would confirm the id exists at all.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buildPublicApiActor, domainErrorToPublicApiResponse, getPublicApiContext, publicApiError, rateLimitedResponse } from '@/lib/public-api-auth'
import { createLoadQueryService, createPublicApiRateLimiter } from '@/server/composition'
import { logError } from '@/lib/observability'
import { GetLoadResponseSchema, LoadIdParamsSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const claims = await getPublicApiContext(request)
  if (claims instanceof NextResponse) return claims

  const limited = await createPublicApiRateLimiter().checkAndIncrement(claims.clientId)
  if (!limited.ok) return publicApiError('server_error', limited.error.detail, 500)
  if (!limited.value.allowed) return rateLimitedResponse(limited.value.retryAfterSeconds)

  const params = LoadIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return publicApiError('invalid_request', 'Invalid id', 400)

  const actor = buildPublicApiActor(claims)
  const result = await createLoadQueryService(createAdminClient()).getDetail(actor, params.data.id)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/public/v1/loads/[id] GET', orgId: actor.orgId }, result.error.detail)
    }
    return domainErrorToPublicApiResponse(result.error)
  }

  const body = GetLoadResponseSchema.parse({ load: result.value.load, events: result.value.events })
  return NextResponse.json(body)
}
