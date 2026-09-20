// GET /api/v1/me — the caller's identity, org, role and capabilities.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { IdentityService } from '@/server/application/identity-service'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { MeResponseSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const actor = await buildActorContext(
    authed.supabase,
    authed.user,
    request.headers.get('x-request-id') ?? crypto.randomUUID()
  )
  if (!actor.ok) return domainErrorResponse(actor.error)

  const identity = new IdentityService().describe(actor.value)
  return NextResponse.json(
    MeResponseSchema.parse({
      user_id: identity.userId,
      org_id: identity.orgId,
      role: identity.role,
      capabilities: identity.capabilities,
    })
  )
}
