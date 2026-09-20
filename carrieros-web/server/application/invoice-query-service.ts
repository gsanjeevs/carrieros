// server/application/invoice-query-service.ts
// Read use cases for invoices. Same role rule as InvoiceService's writes
// (billing_invoices_all: owner/solo/finance — dispatcher has no invoice
// access at all), stated once so read and write cannot drift apart.
import { err, forbidden, notFound, ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { InvoiceDetailRecord, InvoiceQueryRepository, InvoiceSummaryRecord } from '../ports'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

export class InvoiceQueryService {
  constructor(private readonly deps: { readonly invoices: InvoiceQueryRepository }) {}

  async list(actor: ActorContext): Promise<Result<readonly InvoiceSummaryRecord[]>> {
    if (!roleHasCapability(actor.role, 'invoice_actions')) return err(forbidden('This role cannot view invoices', { role: actor.role }))
    return this.deps.invoices.listForOrg(actor)
  }

  async getDetail(actor: ActorContext, invoiceId: number): Promise<Result<InvoiceDetailRecord>> {
    if (!roleHasCapability(actor.role, 'invoice_actions')) return err(forbidden('This role cannot view invoices', { role: actor.role }))
    const found = await this.deps.invoices.getForActor(actor, invoiceId)
    if (!found.ok) return found
    if (!found.value) return err(notFound('Invoice'))
    return ok(found.value)
  }
}
