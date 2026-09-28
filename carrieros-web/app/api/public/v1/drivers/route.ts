// GET /api/public/v1/drivers — list the org's active drivers, for an
// external developer integration authenticated via the OAuth client-
// credentials grant (see .../oauth/token/route.ts). Reuses the SAME
// SetupWriteService.listDrivers() the internal /api/v1/drivers route uses —
// org scoping is decided in exactly one place regardless of which door the
// caller came through.
//
// KNOWN GAP (do not "fix" by widening buildPublicApiActor's role — see that
// file's header comment for why 'finance' was chosen deliberately): unlike
// FleetQueryService.list() and ExceptionQueryService.list(), listDrivers()
// gates on the 'drivers' role_capability, and the synthetic public-API
// actor's role ('finance') does NOT hold it (lib/generated/role-capabilities.ts).
// Every call through this route will therefore return a 403 (FORBIDDEN ->
// invalid_client) today. Route, schema, and OpenAPI registration are wired
// up per the loads/invoices pattern in case that capability gap is closed by
// a future, deliberate decision (e.g. a dedicated public-api role/capability
// set) — this file does not attempt that decision itself.
//
// No Supabase session exists for this caller, so this runs on the ADMIN
// (service_role) client rather than a session-scoped one; same posture as
// app/api/public/v1/loads/route.ts.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buildPublicApiActor, domainErrorToPublicApiResponse, getPublicApiContext, publicApiError, rateLimitedResponse } from '@/lib/public-api-auth'
import { createPublicApiRateLimiter, createSetupWriteService } from '@/server/composition'
import { logError } from '@/lib/observability'
import { ListDriversResponseSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest) {
  const claims = await getPublicApiContext(request)
  if (claims instanceof NextResponse) return claims

  const limited = await createPublicApiRateLimiter().checkAndIncrement(claims.clientId)
  if (!limited.ok) return publicApiError('server_error', limited.error.detail, 500)
  if (!limited.value.allowed) return rateLimitedResponse(limited.value.retryAfterSeconds)

  const actor = buildPublicApiActor(claims)
  const result = await createSetupWriteService(createAdminClient()).listDrivers(actor)
  if (!result.ok) {
    logError({ route: 'api/public/v1/drivers GET', orgId: actor.orgId }, result.error.detail)
    return domainErrorToPublicApiResponse(result.error)
  }

  const body = ListDriversResponseSchema.parse({ drivers: result.value })
  return NextResponse.json(body)
}
