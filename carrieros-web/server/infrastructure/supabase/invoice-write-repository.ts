// server/infrastructure/supabase/invoice-write-repository.ts
// Invoice writes through the CALLER'S client, so RLS still applies. The org scope
// comes from the ActorContext.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { InvoiceDraftPatch, InvoiceWriteRepository } from '../../ports'

export class SupabaseInvoiceWriteRepository implements InvoiceWriteRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async updateDraft(actor: ActorContext, invoiceId: number, patch: InvoiceDraftPatch): Promise<Result<boolean>> {
    const { data, error } = await this.supabase
      .from('invoices')
      .update({ amount: patch.amount, due_date: patch.dueDate, notes: patch.notes })
      .eq('id', invoiceId)
      .eq('carrier_org_id', actor.orgId)
      .eq('status', 'draft') // the draft-only rule is also enforced here, not just in the service
      .select('id')
    if (error) return err(domainError('PRECONDITION_FAILED', `invoice update failed: ${error.message}`))
    return ok((data ?? []).length > 0)
  }

  async markPaid(actor: ActorContext, invoiceId: number, paidAt: Date) {
    // Scope check first: the function runs as the caller (RLS applies) but also filters by the
    // actor's org here so a cross-tenant id answers NOT_FOUND identically.
    const { data: owned } = await this.supabase.from('invoices').select('id').eq('id', invoiceId).eq('carrier_org_id', actor.orgId).maybeSingle()
    if (!owned) return err(domainError('NOT_FOUND', 'Invoice not found'))

    const { data, error } = await this.supabase.rpc('mark_invoice_paid', { p_invoice_id: invoiceId, p_paid_at: paidAt.toISOString() })
    if (error) {
      if (error.code === 'PT404') return err(domainError('NOT_FOUND', 'Invoice not found'))
      return err(domainError('PRECONDITION_FAILED', `mark paid failed: ${error.message}`))
    }
    const row = data as unknown as { outcome: 'APPLIED' | 'ALREADY_PAID'; invoice_id: number }
    return ok({ outcome: row.outcome, invoiceId: Number(row.invoice_id) })
  }
}
