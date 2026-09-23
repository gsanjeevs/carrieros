// PATCH /api/v1/me/driver-profile — a driver edits their OWN driver record. Transport only.
// There is no id in the path: the row is the caller's, from the session.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createFieldActionsService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { DriverProfileResponseSchema, OkResponseSchema, UpdateDriverProfileBodySchema } from '@/server/contract/schemas'

// GET /api/v1/me/driver-profile — the caller's own driver record.
export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createFieldActionsService(authed.supabase).getOwnDriverProfile(actor.value)
  if (!result.ok) return domainErrorResponse(result.error)

  return NextResponse.json(DriverProfileResponseSchema.parse(result.value))
}

export async function PATCH(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Body must be JSON', 400)
  }
  const body = UpdateDriverProfileBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const b = body.data
  const result = await createFieldActionsService(authed.supabase).updateOwnDriverProfile(actor.value, {
    cdlNumber: b.cdl_number,
    cdlClass: b.cdl_class,
    cdlState: b.cdl_state,
    endorsements: b.endorsements,
    emergencyName: b.emergency_contact_name,
    emergencyPhone: b.emergency_contact_phone,
    emergencyRelation: b.emergency_contact_relation,
    defaultVehicleId: b.default_vehicle_id,
  })
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/me/driver-profile PATCH', requestId, userId: authed.user.id }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(OkResponseSchema.parse({ ok: true }))
}
