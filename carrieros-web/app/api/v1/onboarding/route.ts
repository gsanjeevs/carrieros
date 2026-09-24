import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createOnboardingService } from '@/server/composition'
import { OnboardingBodySchema, OnboardingResponseSchema } from '@/server/contract/schemas'
import { asUserId } from '@/server/domain/shared/identity'
import { domainErrorResponse } from '@/server/http-errors'

export async function POST(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed
  let json: unknown
  try { json = await request.json() }
  catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = OnboardingBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  const result = await createOnboardingService(authed.supabase).onboard(asUserId(authed.user.id), {
    companyName: body.data.company_name, mcNumber: body.data.mc_number, dotNumber: body.data.dot_number, ein: body.data.ein,
    address: body.data.address, country: body.data.country, state: body.data.state, city: body.data.city, zip: body.data.zip,
    defaultNetTermsDays: body.data.default_net_terms_days, firstName: body.data.first_name, lastName: body.data.last_name,
    role: body.data.role, tier: body.data.tier,
  })
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') logError({ route: 'api/v1/onboarding POST', userId: authed.user.id }, result.error.detail)
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(OnboardingResponseSchema.parse(result.value), { status: 201 })
}
