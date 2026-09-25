// server/application/invoice-service.ts
// Invoice edits and payment. Roles mirror the billing_invoices_all RLS policy
// (owner, solo, finance); the application layer states the rule so it is tested rather
// than implied, and RLS remains beneath it.
import { buildDraftPatch, type DraftInput } from '../domain/invoice/draft'
import { domainError, err, forbidden, ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { Clock, InvoiceWriteRepository } from '../ports'
import { roleHasCapability } from '@/lib/generated/role-capabilities'
import type { WebhookDispatchService } from './webhook-dispatch-service'

export class InvoiceService {
  constructor(
    private readonly deps: {
      readonly invoices: InvoiceWriteRepository
      readonly clock: Clock
      /** Optional: not every caller (e.g. tests) needs webhook fan-out wired up. */
      readonly webhooks?: WebhookDispatchService
    }
  ) {}

  async updateDraft(actor: ActorContext, invoiceId: number, input: DraftInput): Promise<Result<{ id: number }>> {
    if (!roleHasCapability(actor.role, 'invoice_actions')) return err(forbidden('This role cannot edit invoices', { role: actor.role }))
    const patch = buildDraftPatch(input)
    if (!patch.ok) return patch

    const updated = await this.deps.invoices.updateDraft(actor, invoiceId, patch.value)
    if (!updated.ok) return updated
    if (!updated.value) {
      // Missing, someone else's, or no longer a draft: one answer, so nothing leaks about other orgs' invoices.
      return err(domainError('VERSION_CONFLICT', 'Invoice is not an editable draft', { meta: { reason: 'NOT_A_DRAFT' } }))
    }
    return ok({ id: invoiceId })
  }

  async markPaid(actor: ActorContext, invoiceId: number): Promise<Result<{ outcome: 'APPLIED' | 'ALREADY_PAID'; invoiceId: number }>> {
    if (!roleHasCapability(actor.role, 'invoice_actions')) return err(forbidden('This role cannot mark invoices paid', { role: actor.role }))
    const result = await this.deps.invoices.markPaid(actor, invoiceId, this.deps.clock.now())
    // Webhook fan-out only for a genuine (non-replayed) transition to paid — never block or fail
    // the request on a third party's endpoint responding.
    if (result.ok && result.value.outcome === 'APPLIED') {
      this.deps.webhooks?.dispatchInBackground(actor.orgId, 'invoice.paid', { invoiceId: result.value.invoiceId })
    }
    return result
  }
}
