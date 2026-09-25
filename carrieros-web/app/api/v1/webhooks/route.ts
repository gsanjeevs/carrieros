// GET/POST /api/v1/webhooks — manage the caller's organization's outbound
// webhooks (Settings > Integrations). Ordinary session-authenticated
// /api/v1 — the same trust boundary as /api/v1/oauth-clients, not the
// external OAuth boundary of /api/public/v1. Transport only: authenticate,
// build the actor, delegate to WebhookService (which re-checks the
// subscription_management capability itself).
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createWebhookService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { CreateWebhookBodySchema, CreateWebhookResponseSchema, ListWebhooksResponseSchema } from '@/server/contract/schemas'
import type { WebhookSummary } from '@/server/domain/webhooks/model'

function toApiShape(w: WebhookSummary) {
  return {
    id: w.id,
    url: w.url,
    subscribed_events: w.subscribedEvents,
    enabled: w.enabled,
    created_at: w.createdAt,
    secret_preview: w.secretPreview,
  }
}

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createWebhookService(authed.supabase).list(actor.value)
  if (!result.ok) return domainErrorResponse(result.error)

  const body = ListWebhooksResponseSchema.parse({ webhooks: result.value.map(toApiShape) })
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
  const parsed = CreateWebhookBodySchema.safeParse(json)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createWebhookService(authed.supabase).create(actor.value, {
    url: parsed.data.url,
    subscribedEvents: parsed.data.subscribed_events,
  })
  if (!result.ok) {
    logError({ route: 'api/v1/webhooks POST', requestId, userId: authed.user.id }, result.error.detail)
    return domainErrorResponse(result.error)
  }

  const body = CreateWebhookResponseSchema.parse({
    webhook: toApiShape(result.value.webhook),
    secret: result.value.secret,
  })
  return NextResponse.json(body, { status: 201 })
}
