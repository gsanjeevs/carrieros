// GET /api/v1/webhooks/{webhook_id}/deliveries — recent delivery attempts for
// one webhook (status, timestamp, response code). Read-only, session-
// authenticated. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createWebhookService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { ListWebhookDeliveriesResponseSchema, WebhookIdParamsSchema } from '@/server/contract/schemas'
import type { WebhookDeliveryRecord } from '@/server/domain/webhooks/model'

function toApiShape(d: WebhookDeliveryRecord) {
  return {
    id: d.id,
    webhook_id: d.webhookId,
    event_type: d.eventType,
    status: d.status,
    attempt_count: d.attemptCount,
    last_attempted_at: d.lastAttemptedAt,
    last_response_status: d.lastResponseStatus,
    created_at: d.createdAt,
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ webhook_id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = WebhookIdParamsSchema.safeParse({ webhook_id: (await context.params).webhook_id })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid webhook_id', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createWebhookService(authed.supabase).listDeliveries(actor.value, params.data.webhook_id)
  if (!result.ok) return domainErrorResponse(result.error)

  return NextResponse.json(ListWebhookDeliveriesResponseSchema.parse({ deliveries: result.value.map(toApiShape) }))
}
