// GET/PUT /api/v1/telematics-integrations — manage the caller's organization's Samsara/Motive
// telematics vendor credentials (Settings > Integrations > Telematics). Ordinary
// session-authenticated /api/v1, same trust boundary as /api/v1/webhooks. Transport only:
// authenticate, build the actor, delegate to TelematicsIntegrationService (which re-checks the
// subscription_management capability itself and does the actual encryption).
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createTelematicsIntegrationService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import {
  ListTelematicsIntegrationsResponseSchema,
  UpsertTelematicsIntegrationBodySchema,
  UpsertTelematicsIntegrationResponseSchema,
} from '@/server/contract/schemas'
import type { TelematicsIntegrationSummary } from '@/server/domain/telematics/model'

function toApiShape(i: TelematicsIntegrationSummary) {
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

  const result = await createTelematicsIntegrationService(authed.supabase).list(actor.value)
  if (!result.ok) return domainErrorResponse(result.error)

  const body = ListTelematicsIntegrationsResponseSchema.parse({ integrations: result.value.map(toApiShape) })
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
  const parsed = UpsertTelematicsIntegrationBodySchema.safeParse(json)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createTelematicsIntegrationService(authed.supabase).upsert(actor.value, {
    provider: parsed.data.provider,
    enabled: parsed.data.enabled,
    // Undefined (field absent) means "leave untouched" -- must stay undefined here, not become
    // null, so an enabled-only PUT never accidentally clears the stored credential. Empty string
    // is the explicit "clear" signal, same convention as admin/ai-config's applyKeyFields.
    apiKey: parsed.data.api_key,
    webhookSecret: parsed.data.webhook_secret,
  })
  if (!result.ok) {
    logError({ route: 'api/v1/telematics-integrations PUT', requestId, userId: authed.user.id }, result.error.detail)
    return domainErrorResponse(result.error)
  }

  const body = UpsertTelematicsIntegrationResponseSchema.parse({ integration: toApiShape(result.value) })
  return NextResponse.json(body)
}
