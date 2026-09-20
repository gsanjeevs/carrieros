// POST /api/v1/loads/{id}/milestones — advance a load's execution status.
// Transport only; rules live in ShipmentMilestoneService. Requires an
// Idempotency-Key so a retry (mobile replaying an offline queue, a double-tap)
// can never apply twice.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createShipmentMilestoneService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { parseLoadCommand } from '@/server/http-command'
import { MilestoneResponseSchema, SubmitMilestoneBodySchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const cmd = await parseLoadCommand(request, context, SubmitMilestoneBodySchema)
  if (cmd instanceof NextResponse || isErrorResponse(cmd)) return cmd

  const result = await createShipmentMilestoneService(cmd.supabase).submit(cmd.actor, {
    loadId: cmd.loadId,
    expectedStatus: cmd.body.expected_status,
    newStatus: cmd.body.new_status,
    reason: cmd.body.reason,
    idempotencyKey: cmd.idempotencyKey,
    occurredAt: cmd.body.occurred_at ? new Date(cmd.body.occurred_at) : undefined,
  })
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/loads/[id]/milestones POST', requestId: cmd.requestId, userId: cmd.userId }, result.error.detail)
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
