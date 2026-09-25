// POST /api/v1/webhooks/{webhook_id}/rotate-secret — issue a new signing
// secret for one webhook. The response's secret is shown exactly once, same
// "shown once" contract as create(). Session-authenticated. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createWebhookService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { RotateWebhookSecretResponseSchema, WebhookIdParamsSchema } from '@/server/contract/schemas'
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

export async function POST(request: NextRequest, context: { params: Promise<{ webhook_id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = WebhookIdParamsSchema.safeParse({ webhook_id: (await context.params).webhook_id })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid webhook_id', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createWebhookService(authed.supabase).rotateSecret(actor.value, params.data.webhook_id)
  if (!result.ok) {
    logError({ route: 'api/v1/webhooks/[webhook_id]/rotate-secret POST', requestId, userId: authed.user.id }, result.error.detail)
    return domainErrorResponse(result.error)
  }

  return NextResponse.json(
    RotateWebhookSecretResponseSchema.parse({ webhook: toApiShape(result.value.webhook), secret: result.value.secret })
  )
}
