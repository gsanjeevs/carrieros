// GET /api/public/v1/loads — list the org's loads, for an external developer
// integration authenticated via the OAuth client-credentials grant (see
// .../oauth/token/route.ts). Reuses the SAME LoadQueryService the internal
// /api/v1/loads route and the web loads list page use — org scoping, driver
// restriction and rate visibility are decided in exactly one place regardless
// of which door the caller came through.
//
// No Supabase session exists for this caller, so this runs on the ADMIN
// (service_role) client rather than a session-scoped one; LoadReadRepository
// already scopes every query by actor.orgId itself (its own header comment:
// "defence in depth beside RLS"), which is what makes reusing it here safe —
// the actor's orgId comes only from a verified JWT claim, never from the
// request. Same posture as createChangeFeedService's use of the admin client.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buildPublicApiActor, domainErrorToPublicApiResponse, getPublicApiContext, publicApiError, rateLimitedResponse } from '@/lib/public-api-auth'
import { createLoadQueryService, createPublicApiRateLimiter } from '@/server/composition'
import { logError } from '@/lib/observability'
import { ListLoadsResponseSchema } from '@/server/contract/schemas'
import { PublicListLoadsQuerySchema } from '@/server/contract/public-schemas'

export async function GET(request: NextRequest) {
  const claims = await getPublicApiContext(request)
  if (claims instanceof NextResponse) return claims

  const limited = await createPublicApiRateLimiter().checkAndIncrement(claims.clientId)
  if (!limited.ok) return publicApiError('server_error', limited.error.detail, 500)
  if (!limited.value.allowed) return rateLimitedResponse(limited.value.retryAfterSeconds)

  const params = request.nextUrl.searchParams
  const parsedQuery = PublicListLoadsQuerySchema.safeParse({
    limit: params.has('limit') ? Number(params.get('limit')) : undefined,
  })
  if (!parsedQuery.success) return publicApiError('invalid_request', parsedQuery.error.issues[0]?.message ?? 'Invalid query', 400)

  const actor = buildPublicApiActor(claims)
  const result = await createLoadQueryService(createAdminClient()).list(actor, { limit: parsedQuery.data.limit })
  if (!result.ok) {
    logError({ route: 'api/public/v1/loads GET', orgId: actor.orgId }, result.error.detail)
    return domainErrorToPublicApiResponse(result.error)
  }

  const body = ListLoadsResponseSchema.parse({ loads: result.value.loads, can_see_rate: result.value.canSeeRate })
  return NextResponse.json(body)
}
