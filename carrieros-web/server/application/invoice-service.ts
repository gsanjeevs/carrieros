// server/application/invoice-service.ts
// Invoice edits and payment. Roles mirror the billing_invoices_all RLS policy
// (owner, solo, finance); the application layer states the rule so it is tested rather
// than implied, and RLS remains beneath it.
import { buildDraftPatch, type DraftInput } from '../domain/invoice/draft'
import { domainError, err, forbidden, ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { Clock, InvoiceWriteRepository } from '../ports'

const MAY_MANAGE_INVOICES = new Set(['owner', 'solo', 'finance'])

export class InvoiceService {
  constructor(private readonly deps: { readonly invoices: InvoiceWriteRepository; readonly clock: Clock }) {}

  async updateDraft(actor: ActorContext, invoiceId: number, input: DraftInput): Promise<Result<{ id: number }>> {
    if (!MAY_MANAGE_INVOICES.has(actor.role)) return err(forbidden('This role cannot edit invoices', { role: actor.role }))
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
    if (!MAY_MANAGE_INVOICES.has(actor.role)) return err(forbidden('This role cannot mark invoices paid', { role: actor.role }))
    return this.deps.invoices.markPaid(actor, invoiceId, this.deps.clock.now())
  }
}
