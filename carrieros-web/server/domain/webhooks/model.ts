// server/domain/webhooks/model.ts
// Read shape for a registered outbound webhook (Settings > Integrations
// list) and its delivery history. The secret itself is never part of
// WebhookSummary — like OAuthClientSummary, it exists as a plain value only
// transiently, on the response to create()/rotateSecret().

/** The fixed, known set of event types this app can notify a webhook about.
 * Kept as a plain string union (not a DB enum) so adding an event type is an
 * application-code change, not a migration. */
export const WEBHOOK_EVENT_TYPES = [
  'load.delivered',
  'load.status_changed',
  'invoice.paid',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

export function isWebhookEventType(v: string): v is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(v)
}

export interface WebhookSummary {
  readonly id: number
  readonly url: string
  readonly subscribedEvents: readonly string[]
  readonly enabled: boolean
  readonly createdAt: string
  /** Last 4 characters of the secret only — never the full value after creation. */
  readonly secretPreview: string
}

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed'

export interface WebhookDeliveryRecord {
  readonly id: number
  readonly webhookId: number
  readonly eventType: string
  readonly status: WebhookDeliveryStatus
  readonly attemptCount: number
  readonly lastAttemptedAt: string | null
  readonly lastResponseStatus: number | null
  readonly createdAt: string
}
