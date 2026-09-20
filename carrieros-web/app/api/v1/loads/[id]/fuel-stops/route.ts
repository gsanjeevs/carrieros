// GET /api/v1/loads/{id}/fuel-stops — a load's fuel stops.
// POST /api/v1/loads/{id}/fuel-stops — log a fuel purchase. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createDriverActionService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { ListFuelStopsResponseSchema, LoadIdParamsSchema, LogFuelStopBodySchema, LogFuelStopResponseSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = LoadIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid id', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createDriverActionService(authed.supabase).listFuelStops(actor.value, params.data.id)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id]/fuel-stops GET', requestId, userId: authed.user.id }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(ListFuelStopsResponseSchema.parse({ fuel_stops: result.value }))
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, LogFuelStopBodySchema)
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createDriverActionService(cmd.supabase).logFuelStop(
    cmd.actor,
    cmd.id,
    {
      state: cmd.body.state,
      station: cmd.body.station,
      gallons: cmd.body.gallons,
      pricePerGallon: cmd.body.price_per_gallon,
      totalCost: cmd.body.total_cost,
      odometer: cmd.body.odometer,
      stopDate: cmd.body.stop_date,
    },
    cmd.idempotencyKey
  )
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id]/fuel-stops POST', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(LogFuelStopResponseSchema.parse({ id: result.value.id, total_cost: result.value.totalCost }))
}
