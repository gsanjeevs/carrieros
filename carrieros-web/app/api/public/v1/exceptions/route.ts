// GET /api/public/v1/exceptions — list the org's active exception feed, for
// an external developer integration authenticated via the OAuth client-
// credentials grant (see .../oauth/token/route.ts). Reuses the SAME
// ExceptionQueryService the internal /api/v1/exceptions route uses —
// get_exceptions() itself already filters by role internally
// (owner/solo/dispatcher/finance), and the synthetic public-API actor's role
// ('finance', see lib/public-api-auth.ts) is one of the roles that RPC
// returns exceptions for, so no application-layer capability gate blocks it.
//
// No Supabase session exists for this caller, so this runs on the ADMIN
// (service_role) client rather than a session-scoped one; same posture as
// app/api/public/v1/loads/route.ts.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buildPublicApiActor, domainErrorToPublicApiResponse, getPublicApiContext, publicApiError, rateLimitedResponse } from '@/lib/public-api-auth'
import { createExceptionQueryService, createPublicApiRateLimiter } from '@/server/composition'
import { logError } from '@/lib/observability'
import { ListExceptionsResponseSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest) {
  const claims = await getPublicApiContext(request)
  if (claims instanceof NextResponse) return claims

  const limited = await createPublicApiRateLimiter().checkAndIncrement(claims.clientId)
  if (!limited.ok) return publicApiError('server_error', limited.error.detail, 500)
  if (!limited.value.allowed) return rateLimitedResponse(limited.value.retryAfterSeconds)

  const actor = buildPublicApiActor(claims)
  const result = await createExceptionQueryService(createAdminClient()).list(actor)
  if (!result.ok) {
    logError({ route: 'api/public/v1/exceptions GET', orgId: actor.orgId }, result.error.detail)
    return domainErrorToPublicApiResponse(result.error)
  }

  const body = ListExceptionsResponseSchema.parse({ exceptions: result.value })
  return NextResponse.json(body)
}
