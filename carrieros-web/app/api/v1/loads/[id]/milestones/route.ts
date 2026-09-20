// POST /api/v1/loads/{id}/milestones — advance a load's execution status.
// Transport only; rules live in ShipmentMilestoneService. Requires an
// Idempotency-Key so a retry (mobile replaying an offline queue, a double-tap)
// can never apply twice.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createShipmentMilestoneService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import {
  IdempotencyKeyHeaderSchema,
  LoadIdParamsSchema,
  MilestoneResponseSchema,
  SubmitMilestoneBodySchema,
} from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const rawParams = await context.params
  const params = LoadIdParamsSchema.safeParse({ id: Number(rawParams.id) })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid load id', 400)

  const header = IdempotencyKeyHeaderSchema.safeParse({ 'Idempotency-Key': request.headers.get('idempotency-key') ?? '' })
  if (!header.success) return apiError('VALIDATION_ERROR', 'Idempotency-Key header is required (8-128 characters)', 400)

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Body must be JSON', 400)
  }
  const body = SubmitMilestoneBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createShipmentMilestoneService(authed.supabase).submit(actor.value, {
    loadId: params.data.id,
    expectedStatus: body.data.expected_status,
    newStatus: body.data.new_status,
    reason: body.data.reason,
    idempotencyKey: header.data['Idempotency-Key'],
    occurredAt: body.data.occurred_at ? new Date(body.data.occurred_at) : undefined,
  })
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id]/milestones POST', requestId, userId: authed.user.id }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }

  return NextResponse.json(
    MilestoneResponseSchema.parse({
      outcome: result.value.outcome,
      load_id: result.value.loadId,
      status: result.value.status,
      load_number: result.value.loadNumber,
    })
  )
}
