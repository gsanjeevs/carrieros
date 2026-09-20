// POST /api/v1/vehicles/{id}/service-logs — transport only; rules live in FieldActionsService.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createFieldActionsService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseCommand } from '@/server/http-command'
import { LogServiceBodySchema, LogServiceResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseCommand(request, context, LogServiceBodySchema, { requireIdempotencyKey: true })
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createFieldActionsService(cmd.supabase).logVehicleService(cmd.actor, cmd.id, { serviceType: cmd.body.service_type, serviceDate: cmd.body.service_date, odometer: cmd.body.odometer, cost: cmd.body.cost, shopName: cmd.body.shop_name, notes: cmd.body.notes, reminderId: cmd.body.reminder_id }, cmd.idempotencyKey)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'POST /api/v1/vehicles/{id}/service-logs', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(LogServiceResponseSchema.parse({ id: result.value.id }))
}
