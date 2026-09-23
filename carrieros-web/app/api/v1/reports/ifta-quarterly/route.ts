// GET /api/v1/reports/ifta-quarterly — org-wide quarterly IFTA state mileage. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createIftaService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { IftaQuarterlySummaryQuerySchema, IftaQuarterlySummaryResponseSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const query = IftaQuarterlySummaryQuerySchema.safeParse({ quarter: request.nextUrl.searchParams.get('quarter') })
  if (!query.success) return apiError('VALIDATION_ERROR', query.error.issues[0]?.message ?? 'Invalid query', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createIftaService(authed.supabase).quarterlySummary(actor.value, query.data.quarter)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/reports/ifta-quarterly GET', requestId, userId: authed.user.id }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(IftaQuarterlySummaryResponseSchema.parse(result.value))
}
