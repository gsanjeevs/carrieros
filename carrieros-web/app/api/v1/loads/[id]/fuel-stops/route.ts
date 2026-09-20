// POST /api/v1/loads/{id}/fuel-stops — log a fuel purchase. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createDriverActionService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { LogFuelStopBodySchema, LogFuelStopResponseSchema } from '@/server/contract/schemas'

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
