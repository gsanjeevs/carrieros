// server/application/financial-event-query-service.ts
// Ledger-shaped export of financial outbox events (T19 readiness layer).
// Same role gate as invoices (billing_invoices_all / invoice_actions):
// settlements and expenses are also finance-visible data, and this export
// exists specifically for a finance-facing integration (an accounting sync),
// so one capability check covers all three source types rather than a
// per-category rule that could drift from the resource-level ones.
import { err, forbidden, ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { FinancialEventQueryRepository, FinancialOutboxRecord } from '../ports'
import { amountFor, categorize } from '../domain/financial-events/categorize'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

export interface FinancialEventView {
  readonly id: string
  readonly event_type: string
  readonly category: string
  readonly amount: number
  readonly currency: string
  readonly occurred_at: string
  readonly reference: {
    readonly invoice_number: string | null
    readonly load_id: number | null
    readonly driver_id: number | null
    readonly settlement_id: number | null
  }
}

function toView(record: FinancialOutboxRecord, currency: string): FinancialEventView | null {
  const category = categorize(record.eventType, record.payload)
  if (!category) return null // defensive: listSince() already filters to known event_types
  const p = record.payload
  return {
    id: String(record.id),
    event_type: record.eventType,
    category,
    amount: amountFor(record.eventType, p),
    currency,
    occurred_at: record.occurredAt,
    reference: {
      invoice_number: typeof p.invoiceNumber === 'string' ? p.invoiceNumber : null,
      load_id: typeof p.loadId === 'number' ? p.loadId : null,
      driver_id: typeof p.driverId === 'number' ? p.driverId : null,
      settlement_id: typeof p.settlementId === 'number' ? p.settlementId : null,
    },
  }
}

export class FinancialEventQueryService {
  constructor(private readonly deps: { readonly events: FinancialEventQueryRepository }) {}

  async list(
    actor: ActorContext,
    cursor: number,
    limit: number
  ): Promise<Result<{ events: readonly FinancialEventView[]; nextCursor: string | null }>> {
    if (!roleHasCapability(actor.role, 'invoice_actions')) {
      return err(forbidden('This role cannot view financial events', { role: actor.role }))
    }

    const result = await this.deps.events.listSince(actor, cursor, limit)
    if (!result.ok) return result

    const events = result.value.events
      .map((r) => toView(r, result.value.currency))
      .filter((v): v is FinancialEventView => v !== null)

    // The cursor is the LAST event's own id — a full page means there may be
    // more; a short page means the caller has caught up to "now" and should
    // resume from the same cursor on their next poll.
    const nextCursor = events.length === limit && events.length > 0 ? events[events.length - 1].id : null

    return ok({ events, nextCursor })
  }
}
