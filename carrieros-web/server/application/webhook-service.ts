// server/application/webhook-service.ts
// Settings-surface CRUD for org-level outbound webhooks (Settings >
// Integrations). Gated by the SAME capability as billing/developer-api
// (subscription_management: owner/solo only) — a webhook can leak every
// event this app fires for the org to an arbitrary URL, so it belongs next
// to the other "who may configure org-wide integrations" actions, not a new
// capability that would mean the same thing.
import { randomBytes } from 'node:crypto'
import { err, forbidden, notFound, ok, validationFailed, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import { isWebhookEventType, type WebhookDeliveryRecord, type WebhookSummary } from '../domain/webhooks/model'
import type { WebhookRepository } from '../ports'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

export interface CreatedWebhook {
  readonly webhook: WebhookSummary
  /** The RAW secret. Present only on the response to create()/rotateSecret() — never returned again. */
  readonly secret: string
}

function newSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`
}

function validateUrl(url: string): Result<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return err(validationFailed('Webhook URL must be a valid absolute URL', { url: 'INVALID_URL' }))
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return err(validationFailed('Webhook URL must use http or https', { url: 'INVALID_PROTOCOL' }))
  }
  return ok(undefined)
}

function validateEvents(events: readonly string[]): Result<void> {
  if (events.length === 0) {
    return err(validationFailed('Select at least one event to subscribe to', { subscribed_events: 'EMPTY' }))
  }
  const unknown = events.find((e) => !isWebhookEventType(e))
  if (unknown) {
    return err(validationFailed(`"${unknown}" is not a known event type`, { subscribed_events: 'UNKNOWN_EVENT_TYPE' }))
  }
  return ok(undefined)
}

export class WebhookService {
  constructor(private readonly deps: { readonly webhooks: WebhookRepository }) {}

  private authorize(actor: ActorContext): Result<void> {
    if (!roleHasCapability(actor.role, 'subscription_management')) {
      return err(forbidden('This role cannot manage integrations', { role: actor.role }))
    }
    return ok(undefined)
  }

  async list(actor: ActorContext): Promise<Result<readonly WebhookSummary[]>> {
    const authorized = this.authorize(actor)
    if (!authorized.ok) return authorized
    return this.deps.webhooks.listForOrg(actor)
  }

  async create(actor: ActorContext, input: { url: string; subscribedEvents: readonly string[] }): Promise<Result<CreatedWebhook>> {
    const authorized = this.authorize(actor)
    if (!authorized.ok) return authorized

    const urlCheck = validateUrl(input.url)
    if (!urlCheck.ok) return urlCheck
    const eventsCheck = validateEvents(input.subscribedEvents)
    if (!eventsCheck.ok) return eventsCheck

    const secret = newSecret()
    const created = await this.deps.webhooks.create(actor, { url: input.url, secret, subscribedEvents: input.subscribedEvents })
    if (!created.ok) return created
    return ok({ webhook: created.value, secret })
  }

  async update(
    actor: ActorContext,
    webhookId: number,
    patch: { url?: string; subscribedEvents?: readonly string[]; enabled?: boolean }
  ): Promise<Result<WebhookSummary>> {
    const authorized = this.authorize(actor)
    if (!authorized.ok) return authorized

    if (patch.url !== undefined) {
      const urlCheck = validateUrl(patch.url)
      if (!urlCheck.ok) return urlCheck
    }
    if (patch.subscribedEvents !== undefined) {
      const eventsCheck = validateEvents(patch.subscribedEvents)
      if (!eventsCheck.ok) return eventsCheck
    }

    const updated = await this.deps.webhooks.update(actor, webhookId, patch)
    if (!updated.ok) return updated
    if (!updated.value) return err(notFound('Webhook'))
    return ok(updated.value)
  }

  async delete(actor: ActorContext, webhookId: number): Promise<Result<boolean>> {
    const authorized = this.authorize(actor)
    if (!authorized.ok) return authorized
    return this.deps.webhooks.delete(actor, webhookId)
  }

  async rotateSecret(actor: ActorContext, webhookId: number): Promise<Result<CreatedWebhook>> {
    const authorized = this.authorize(actor)
    if (!authorized.ok) return authorized

    const secret = newSecret()
    const rotated = await this.deps.webhooks.rotateSecret(actor, webhookId, secret)
    if (!rotated.ok) return rotated
    if (!rotated.value) return err(notFound('Webhook'))
    return ok({ webhook: rotated.value, secret })
  }

  async listDeliveries(actor: ActorContext, webhookId: number, limit = 25): Promise<Result<readonly WebhookDeliveryRecord[]>> {
    const authorized = this.authorize(actor)
    if (!authorized.ok) return authorized
    return this.deps.webhooks.listDeliveries(actor, webhookId, limit)
  }
}
