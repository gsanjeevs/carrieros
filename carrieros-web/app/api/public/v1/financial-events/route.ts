// GET /api/public/v1/financial-events — ledger-shaped, cursor-paginated export
// of invoice/settlement/expense events for an eventual accounting sync (T19:
// build the readiness layer now, defer the live QuickBooks/NetSuite connector
// — decisions.md). Same OAuth2 client-credentials + rate-limiter + actor
// pattern as the existing app/api/public/v1/invoices route; extends T14's
// public API rather than inventing a second integration surface.
import { NextRequest, NextResponse } from 'next/server'
import {
  buildPublicApiActor,
  domainErrorToPublicApiResponse,
  getPublicApiContext,
  publicApiError,
  rateLimitedResponse,
} from '@/lib/public-api-auth'
import { createFinancialEventQueryService, createPublicApiRateLimiter } from '@/server/composition'
import { logError } from '@/lib/observability'
import { ListFinancialEventsQuerySchema, ListFinancialEventsResponseSchema } from '@/server/contract/schemas'

const DEFAULT_LIMIT = 100

export async function GET(request: NextRequest) {
  const claims = await getPublicApiContext(request)
  if (claims instanceof NextResponse) return claims

  const limited = await createPublicApiRateLimiter().checkAndIncrement(claims.clientId)
  if (!limited.ok) return publicApiError('server_error', limited.error.detail, 500)
  if (!limited.value.allowed) return rateLimitedResponse(limited.value.retryAfterSeconds)

  const query = ListFinancialEventsQuerySchema.safeParse({
    cursor: request.nextUrl.searchParams.get('cursor') ?? undefined,
    limit: request.nextUrl.searchParams.get('limit') ?? undefined,
  })
  if (!query.success) return publicApiError('invalid_request', query.error.issues[0]?.message ?? 'Invalid query', 400)

  const actor = buildPublicApiActor(claims)
  const result = await createFinancialEventQueryService().list(actor, query.data.cursor ?? 0, query.data.limit ?? DEFAULT_LIMIT)
  if (!result.ok) {
    logError({ route: 'api/public/v1/financial-events GET', orgId: actor.orgId }, result.error.detail)
    return domainErrorToPublicApiResponse(result.error)
  }

  const body = ListFinancialEventsResponseSchema.parse({
    events: result.value.events,
    next_cursor: result.value.nextCursor,
  })
  return NextResponse.json(body)
}
