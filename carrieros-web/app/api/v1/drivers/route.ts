import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createSetupWriteService } from '@/server/composition'
import { ListDriversResponseSchema } from '@/server/contract/schemas'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed
  const actor = await buildActorContext(authed.supabase, authed.user, request.headers.get('x-request-id') ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)
  const result = await createSetupWriteService(authed.supabase).listDrivers(actor.value)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(ListDriversResponseSchema.parse({ drivers: result.value }))
}
