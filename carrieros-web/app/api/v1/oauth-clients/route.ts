// GET/POST /api/v1/oauth-clients — manage the caller's organization's public
// developer API clients. This is ordinary session-authenticated /api/v1 (a
// logged-in owner/solo human), NOT /api/public/v1 (an external OAuth
// client) — do not confuse the two trust boundaries. Transport only:
// authenticate, build the actor, delegate to OAuthClientService (which
// re-checks the subscription_management capability itself).
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createOAuthClientService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { CreateOAuthClientBodySchema, CreateOAuthClientResponseSchema, ListOAuthClientsResponseSchema } from '@/server/contract/schemas'

function toApiShape(c: { id: number; clientId: string; name: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }) {
  return { id: c.id, client_id: c.clientId, name: c.name, created_at: c.createdAt, last_used_at: c.lastUsedAt, revoked_at: c.revokedAt }
}

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createOAuthClientService().list(actor.value)
  if (!result.ok) return domainErrorResponse(result.error)

  const body = ListOAuthClientsResponseSchema.parse({ clients: result.value.map(toApiShape) })
  return NextResponse.json(body)
}

export async function POST(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Body must be JSON', 400)
  }
  const parsed = CreateOAuthClientBodySchema.safeParse(json)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createOAuthClientService().create(actor.value, parsed.data.name)
  if (!result.ok) {
    logError({ route: 'api/v1/oauth-clients POST', requestId, userId: authed.user.id }, result.error.detail)
    return domainErrorResponse(result.error)
  }

  const body = CreateOAuthClientResponseSchema.parse({
    client: toApiShape(result.value.client),
    client_secret: result.value.clientSecret,
  })
  return NextResponse.json(body, { status: 201 })
}
