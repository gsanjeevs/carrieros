// GET /api/public/v1/vehicles — list the org's active vehicles, for an
// external developer integration authenticated via the OAuth client-
// credentials grant (see .../oauth/token/route.ts). Reuses the SAME
// FleetQueryService the internal /api/v1/vehicles route uses — org scoping
// is decided in exactly one place regardless of which door the caller came
// through. FleetQueryService.list() has no role/capability gate beyond org
// scoping (see its header comment), so this works for the synthetic
// 'finance' actor the same as it does for every internal role.
//
// No Supabase session exists for this caller, so this runs on the ADMIN
// (service_role) client rather than a session-scoped one; same posture as
// app/api/public/v1/loads/route.ts.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buildPublicApiActor, domainErrorToPublicApiResponse, getPublicApiContext, publicApiError, rateLimitedResponse } from '@/lib/public-api-auth'
import { createFleetQueryService, createPublicApiRateLimiter } from '@/server/composition'
import { logError } from '@/lib/observability'
import { ListVehiclesResponseSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest) {
  const claims = await getPublicApiContext(request)
  if (claims instanceof NextResponse) return claims

  const limited = await createPublicApiRateLimiter().checkAndIncrement(claims.clientId)
  if (!limited.ok) return publicApiError('server_error', limited.error.detail, 500)
  if (!limited.value.allowed) return rateLimitedResponse(limited.value.retryAfterSeconds)

  const actor = buildPublicApiActor(claims)
  const result = await createFleetQueryService(createAdminClient()).list(actor)
  if (!result.ok) {
    logError({ route: 'api/public/v1/vehicles GET', orgId: actor.orgId }, result.error.detail)
    return domainErrorToPublicApiResponse(result.error)
  }

  const body = ListVehiclesResponseSchema.parse({ vehicles: result.value })
  return NextResponse.json(body)
}
