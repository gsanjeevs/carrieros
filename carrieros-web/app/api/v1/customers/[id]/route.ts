// GET /api/v1/customers/{id} — a customer, its recent loads, and its health score. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createCustomerQueryService, createSetupWriteService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { CustomerIdParamsSchema, GetCustomerResponseSchema, UpdateCustomerBodySchema, UpdateCustomerResponseSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = CustomerIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid id', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createCustomerQueryService(authed.supabase).getDetail(actor.value, params.data.id)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/customers/[id] GET', requestId, userId: authed.user.id }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  const body = GetCustomerResponseSchema.parse({
    customer: result.value.customer,
    recent_loads: result.value.recent_loads,
    health_score: result.value.health_score,
  })
  return NextResponse.json(body)
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = CustomerIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid id', 400)

  let json: unknown
  try { json = await request.json() }
  catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = UpdateCustomerBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createSetupWriteService(authed.supabase).updateCustomer(actor.value, params.data.id, body.data)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(UpdateCustomerResponseSchema.parse(result.value))
}
