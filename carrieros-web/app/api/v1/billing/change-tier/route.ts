// POST /api/v1/billing/change-tier — the demo payment and plan update are
// committed atomically; no Stripe call or real card charge is made.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createSetupWriteService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { ChangeTierBodySchema, ChangeTierResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  let json: unknown
  try { json = await request.json() }
  catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = ChangeTierBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const suppliedKey = request.headers.get('idempotency-key')
  if (suppliedKey && !/^[0-9a-f-]{36}$/i.test(suppliedKey)) return apiError('VALIDATION_ERROR', 'Idempotency-Key must be a UUID', 400)
  const paymentReference = `demo:${authed.user.id}:${suppliedKey ?? crypto.randomUUID()}`
  const result = await createSetupWriteService(authed.supabase).changeTier(actor.value, body.data.tier, paymentReference)
  if (!result.ok) return domainErrorResponse(result.error)
  const payment = result.value
  return NextResponse.json(ChangeTierResponseSchema.parse({
    tier: payment.tier,
    payment: {
      reference: payment.event_id == null ? null : `DEMO-${payment.event_id}`,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.event_status,
      simulated: true,
    },
  }))
}
