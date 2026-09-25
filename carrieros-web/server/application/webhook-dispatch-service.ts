// server/application/webhook-dispatch-service.ts
// First real webhook delivery in this codebase. Given an org and an event
// that already happened, looks up every enabled webhook subscribed to it and
// POSTs the payload, HMAC-signed with that webhook's own secret.
//
// Deliberately NOT a job queue: this is a first version (per the task's
// scope), so delivery runs inline/best-effort from whatever request produced
// the triggering event, with a small bounded number of immediate retries. A
// caller MUST NOT `await` dispatch() before responding to its own request —
// use dispatchInBackground() (fire-and-forget) from any domain mutation's
// success path so the triggering user is never blocked on a third party's
// endpoint responding.
import { createHmac } from 'node:crypto'
import type { OrgId } from '../domain/shared/identity'
import type { WebhookDeliveryWriter, WebhookRepository } from '../ports'

const MAX_ATTEMPTS = 3
const TIMEOUT_MS = 5_000
const RETRY_DELAY_MS = [250, 750] // between attempts 1→2 and 2→3

export const WEBHOOK_SIGNATURE_HEADER = 'X-CarrierOS-Signature'

/** Hex HMAC-SHA256 of the raw JSON payload bytes under `secret`. Pure — no I/O — so it is
 * unit-testable without a server, and so the exact same computation the receiving end must
 * reproduce (over the exact bytes sent) is a single, obviously-correct function. */
export function signPayload(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class WebhookDispatchService {
  constructor(
    private readonly deps: {
      readonly webhooks: WebhookRepository
      readonly deliveries: WebhookDeliveryWriter
      readonly fetchImpl?: typeof fetch
    }
  ) {}

  /** Fire-and-forget: swallows all errors (already recorded per-attempt in webhook_deliveries)
   * so a webhook delivery failure can never surface as a failure of the triggering request. */
  dispatchInBackground(orgId: OrgId, eventType: string, payload: Record<string, unknown>): void {
    this.dispatch(orgId, eventType, payload).catch(() => {
      // Deliberately swallowed — see header comment. Every attempt is already
      // durably recorded via WebhookDeliveryWriter regardless of outcome.
    })
  }

  async dispatch(orgId: OrgId, eventType: string, payload: Record<string, unknown>): Promise<void> {
    const found = await this.deps.webhooks.findEnabledForDispatch(orgId, eventType)
    if (!found.ok || found.value.length === 0) return

    await Promise.all(found.value.map((webhook) => this.deliverOne(webhook, eventType, payload)))
  }

  private async deliverOne(
    webhook: { id: number; orgId: OrgId; url: string; secret: string },
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const fetchImpl = this.deps.fetchImpl ?? fetch
    const rawBody = JSON.stringify({ event: eventType, data: payload })
    const signature = signPayload(rawBody, webhook.secret)

    let lastStatus: number | null = null
    let attempt = 0
    let succeeded = false

    while (attempt < MAX_ATTEMPTS && !succeeded) {
      attempt += 1
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
        try {
          const res = await fetchImpl(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              [WEBHOOK_SIGNATURE_HEADER]: signature,
            },
            body: rawBody,
            signal: controller.signal,
          })
          lastStatus = res.status
          succeeded = res.ok
        } finally {
          clearTimeout(timer)
        }
      } catch {
        lastStatus = null
      }

      if (!succeeded && attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS[attempt - 1] ?? RETRY_DELAY_MS[RETRY_DELAY_MS.length - 1])
      }
    }

    await this.deps.deliveries.recordAttempt({
      webhookId: webhook.id,
      orgId: webhook.orgId,
      eventType,
      payload,
      status: succeeded ? 'success' : 'failed',
      attemptCount: attempt,
      responseStatus: lastStatus,
    })
  }
}
