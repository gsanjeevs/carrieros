// GET /api/v1/vehicles — list the organization's active vehicles. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createFleetQueryService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { CreateVehicleBodySchema, CreateVehicleResponseSchema, ListVehiclesResponseSchema } from '@/server/contract/schemas'
import { parseResourceRequest, isHttpResponse } from '@/server/http-resource'
import { createSetupWriteService } from '@/server/composition'

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createFleetQueryService(authed.supabase).list(actor.value)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/vehicles GET', requestId, userId: authed.user.id }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }

  return NextResponse.json(ListVehiclesResponseSchema.parse({ vehicles: result.value }))
}

export async function POST(request: NextRequest) {
  const cmd = await parseResourceRequest(request, CreateVehicleBodySchema)
  if (isHttpResponse(cmd)) return cmd
  const body = cmd.body!
  const result = await createSetupWriteService(cmd.supabase).createVehicle(cmd.actor, {
    vehicleTypeId: body.vehicle_type_id, nickname: body.nickname, year: body.year, make: body.make, model: body.model,
    vin: body.vin, licensePlate: body.license_plate, licenseState: body.license_state, cabType: body.cab_type,
    color: body.color, dimensions: body.dimensions,
  }, cmd.idempotencyKey)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(CreateVehicleResponseSchema.parse(result.value), { status: 201 })
}
