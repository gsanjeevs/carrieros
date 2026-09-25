// PATCH/DELETE /api/v1/webhooks/{webhook_id} — edit or delete one webhook.
// Session-authenticated (owner/solo human). Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createWebhookService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { notFound } from '@/server/domain/shared/result'
import { DeleteWebhookResponseSchema, UpdateWebhookBodySchema, UpdateWebhookResponseSchema, WebhookIdParamsSchema } from '@/server/contract/schemas'
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

export async function PATCH(request: NextRequest, context: { params: Promise<{ webhook_id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = WebhookIdParamsSchema.safeParse({ webhook_id: (await context.params).webhook_id })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid webhook_id', 400)

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Body must be JSON', 400)
  }
  const parsed = UpdateWebhookBodySchema.safeParse(json)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createWebhookService(authed.supabase).update(actor.value, params.data.webhook_id, {
    url: parsed.data.url,
    subscribedEvents: parsed.data.subscribed_events,
    enabled: parsed.data.enabled,
  })
  if (!result.ok) {
    logError({ route: 'api/v1/webhooks/[webhook_id] PATCH', requestId, userId: authed.user.id }, result.error.detail)
    return domainErrorResponse(result.error)
  }

  return NextResponse.json(UpdateWebhookResponseSchema.parse({ webhook: toApiShape(result.value) }))
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ webhook_id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = WebhookIdParamsSchema.safeParse({ webhook_id: (await context.params).webhook_id })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid webhook_id', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createWebhookService(authed.supabase).delete(actor.value, params.data.webhook_id)
  if (!result.ok) {
    logError({ route: 'api/v1/webhooks/[webhook_id] DELETE', requestId, userId: authed.user.id }, result.error.detail)
    return domainErrorResponse(result.error)
  }
  if (!result.value) return domainErrorResponse(notFound('Webhook'))

  return NextResponse.json(DeleteWebhookResponseSchema.parse({ ok: true }))
}
