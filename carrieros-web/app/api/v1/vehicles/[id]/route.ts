// GET /api/v1/vehicles/{id} — one vehicle with its service history and active
// maintenance reminders. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createFleetQueryService, createSetupWriteService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { LoadIdParamsSchema, UpdateVehicleBodySchema, UpdateVehicleResponseSchema, VehicleDetailResponseSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = LoadIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid id', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createFleetQueryService(authed.supabase).getDetail(actor.value, params.data.id)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/vehicles/[id] GET', requestId, userId: authed.user.id }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }

  const v = result.value
  const body = VehicleDetailResponseSchema.parse({
    id: v.id,
    vehicle_number: v.vehicle_number,
    nickname: v.nickname,
    status: v.status,
    service_logs: v.service_logs,
    maintenance_reminders: v.maintenance_reminders.map((r) => ({
      id: r.id,
      reminder_type: r.reminderType,
      trigger_miles: r.triggerMiles,
      trigger_months: r.triggerMonths,
    })),
  })
  return NextResponse.json(body)
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = LoadIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid id', 400)

  let json: unknown
  try { json = await request.json() }
  catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = UpdateVehicleBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createSetupWriteService(authed.supabase).updateVehicle(actor.value, params.data.id, body.data)
  if (!result.ok) return domainErrorResponse(result.error)
  if (!result.value) return apiError('NOT_FOUND', 'Vehicle not found', 404)
  return NextResponse.json(UpdateVehicleResponseSchema.parse(result.value))
}
