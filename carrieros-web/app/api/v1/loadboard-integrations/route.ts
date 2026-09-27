// GET/PUT /api/v1/loadboard-integrations — manage the caller's organization's DAT load-board
// credential (Settings > Integrations > Load Board). Ordinary session-authenticated /api/v1, same
// trust boundary as /api/v1/telematics-integrations. Transport only: authenticate, build the actor,
// delegate to LoadboardIntegrationService (which re-checks the loadboard_posting capability AND the
// loadboard_posting Growth+ feature gate itself, and does the actual encryption).
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createLoadboardIntegrationService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import {
  ListLoadboardIntegrationsResponseSchema,
  UpsertLoadboardIntegrationBodySchema,
  UpsertLoadboardIntegrationResponseSchema,
} from '@/server/contract/schemas'
import type { LoadboardIntegrationSummary } from '@/server/domain/loadboard/model'

function toApiShape(i: LoadboardIntegrationSummary) {
  return {
    provider: i.provider,
    enabled: i.enabled,
    credential_configured: i.credentialConfigured,
    updated_at: i.updatedAt,
    updated_by: i.updatedBy,
  }
}

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createLoadboardIntegrationService(authed.supabase).list(actor.value)
  if (!result.ok) return domainErrorResponse(result.error)

  const body = ListLoadboardIntegrationsResponseSchema.parse({ integrations: result.value.map(toApiShape) })
  return NextResponse.json(body)
}

export async function PUT(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Body must be JSON', 400)
  }
  const parsed = UpsertLoadboardIntegrationBodySchema.safeParse(json)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createLoadboardIntegrationService(authed.supabase).upsert(actor.value, {
    provider: parsed.data.provider,
    enabled: parsed.data.enabled,
    // Undefined (field absent) means "leave untouched" -- must stay undefined, not become null, so an
    // enabled-only PUT never accidentally clears the stored credential. Empty string is the explicit
    // "clear" signal.
    apiKey: parsed.data.api_key,
  })
  if (!result.ok) {
    logError({ route: 'api/v1/loadboard-integrations PUT', requestId, userId: authed.user.id }, result.error.detail)
    return domainErrorResponse(result.error)
  }

  const body = UpsertLoadboardIntegrationResponseSchema.parse({ integration: toApiShape(result.value) })
  return NextResponse.json(body)
}
