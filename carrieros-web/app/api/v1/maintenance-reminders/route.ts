// GET /api/v1/maintenance-reminders — fleet-wide active reminders. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createFleetQueryService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { ListMaintenanceRemindersResponseSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createFleetQueryService(authed.supabase).listReminders(actor.value)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/maintenance-reminders GET', requestId, userId: authed.user.id }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  const body = ListMaintenanceRemindersResponseSchema.parse({
    reminders: result.value.map((r) => ({
      id: r.id,
      vehicle_id: r.vehicleId,
      reminder_type: r.reminderType,
      next_due_date: r.nextDueDate,
      next_due_miles: r.nextDueMiles,
      vehicle: r.vehicle,
    })),
  })
  return NextResponse.json(body)
}
