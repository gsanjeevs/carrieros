// GET /api/public/v1/invoices — list the org's invoices, for the public
// developer API. Reuses the SAME InvoiceQueryService as the internal
// /api/v1/invoices route (same invoice_actions capability check — the
// synthetic actor here is built with role 'finance', which holds it; see
// lib/public-api-auth.ts's buildPublicApiActor for why).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buildPublicApiActor, domainErrorToPublicApiResponse, getPublicApiContext, publicApiError, rateLimitedResponse } from '@/lib/public-api-auth'
import { createInvoiceQueryService, createPublicApiRateLimiter } from '@/server/composition'
import { logError } from '@/lib/observability'
import { ListInvoicesResponseSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest) {
  const claims = await getPublicApiContext(request)
  if (claims instanceof NextResponse) return claims

  const limited = await createPublicApiRateLimiter().checkAndIncrement(claims.clientId)
  if (!limited.ok) return publicApiError('server_error', limited.error.detail, 500)
  if (!limited.value.allowed) return rateLimitedResponse(limited.value.retryAfterSeconds)

  const actor = buildPublicApiActor(claims)
  const result = await createInvoiceQueryService(createAdminClient()).list(actor)
  if (!result.ok) {
    logError({ route: 'api/public/v1/invoices GET', orgId: actor.orgId }, result.error.detail)
    return domainErrorToPublicApiResponse(result.error)
  }

  const body = ListInvoicesResponseSchema.parse({ invoices: result.value })
  return NextResponse.json(body)
}
