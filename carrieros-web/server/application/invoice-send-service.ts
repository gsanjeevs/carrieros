import { roleHasCapability } from '@/lib/generated/role-capabilities'
import { buildInvoiceEmail } from '../domain/invoice/send'
import { domainError, err, forbidden, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { Clock, EmailGateway, InvoiceWriteRepository } from '../ports'

export class InvoiceSendService {
  constructor(private readonly deps: {
    readonly invoices: InvoiceWriteRepository
    readonly email: EmailGateway
    readonly clock: Clock
    readonly appUrl: string
  }) {}

  async send(actor: ActorContext, invoiceId: number): Promise<Result<{ invoiceNumber: string; warningCode?: string }>> {
    if (!roleHasCapability(actor.role, 'invoice_actions')) return err(forbidden('This role cannot send invoices', { role: actor.role }))
    const found = await this.deps.invoices.findForSend(actor, invoiceId)
    if (!found.ok) return found
    if (!found.value) return err(domainError('NOT_FOUND', 'Invoice not found'))

    let warningCode: string | undefined
    if (found.value.recipient) {
      const message = buildInvoiceEmail({
        invoiceId,
        invoiceNumber: found.value.invoiceNumber,
        amount: found.value.amount,
        dueDate: found.value.dueDate,
        customerName: found.value.customerName,
        loadTrackingToken: found.value.loadTrackingToken,
        currency: found.value.currency,
      }, this.deps.appUrl)
      const sent = await this.deps.email.send({ to: found.value.recipient, ...message })
      if (!sent.ok) return err(domainError('EMAIL_SEND_FAILED', 'Could not send invoice'))
    } else {
      warningCode = 'NO_RECIPIENT_EMAIL'
    }

    const marked = await this.deps.invoices.markSent(actor, invoiceId, this.deps.clock.now())
    if (!marked.ok) return marked
    return { ok: true, value: { invoiceNumber: found.value.invoiceNumber, ...(warningCode ? { warningCode } : {}) } }
  }
}
