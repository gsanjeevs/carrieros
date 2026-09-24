// GET /api/v1/customers — the carrier's customer orgs. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createCustomerQueryService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { CreateCustomerBodySchema, CreateCustomerResponseSchema, ListCustomersResponseSchema } from '@/server/contract/schemas'
import { parseResourceRequest, isHttpResponse } from '@/server/http-resource'
import { createSetupWriteService } from '@/server/composition'

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createCustomerQueryService(authed.supabase).list(actor.value)
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/v1/customers GET', requestId, userId: authed.user.id }, result.error.detail)
    }
    return domainErrorResponse(result.error)
  }
  return NextResponse.json(ListCustomersResponseSchema.parse({ customers: result.value }))
}

export async function POST(request: NextRequest) {
  const cmd = await parseResourceRequest(request, CreateCustomerBodySchema)
  if (isHttpResponse(cmd)) return cmd
  const body = cmd.body!
  const result = await createSetupWriteService(cmd.supabase).createCustomer(cmd.actor, {
    name: body.name, phone: body.phone, email: body.email, address: body.address, city: body.city,
    state: body.state, zip: body.zip, country: body.country, contactName: body.contact_name, notes: body.notes,
  }, cmd.idempotencyKey)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(CreateCustomerResponseSchema.parse(result.value), { status: 201 })
}
