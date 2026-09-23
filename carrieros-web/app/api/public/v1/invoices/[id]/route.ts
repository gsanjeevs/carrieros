// GET /api/public/v1/invoices/{id} — one invoice, for the public developer
// API. Reuses the SAME InvoiceQueryService as the internal
// /api/v1/invoices/{id} route; another org's client requesting this id gets
// 404, matching this codebase's established "don't reveal existence" pattern.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buildPublicApiActor, domainErrorToPublicApiResponse, getPublicApiContext, publicApiError, rateLimitedResponse } from '@/lib/public-api-auth'
import { createInvoiceQueryService, createPublicApiRateLimiter } from '@/server/composition'
import { logError } from '@/lib/observability'
import { InvoiceDetailResponseSchema, InvoiceIdParamsSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const claims = await getPublicApiContext(request)
  if (claims instanceof NextResponse) return claims

  const limited = await createPublicApiRateLimiter().checkAndIncrement(claims.clientId)
  if (!limited.ok) return publicApiError('server_error', limited.error.detail, 500)
  if (!limited.value.allowed) return rateLimitedResponse(limited.value.retryAfterSeconds)

  const params = InvoiceIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return publicApiError('invalid_request', 'Invalid id', 400)

  const actor = buildPublicApiActor(claims)
  const result = await createInvoiceQueryService(createAdminClient()).getDetail(actor, params.data.id)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/public/v1/invoices/[id] GET', orgId: actor.orgId }, result.error.detail)
    }
    return domainErrorToPublicApiResponse(result.error)
  }

  return NextResponse.json(InvoiceDetailResponseSchema.parse(result.value))
}
