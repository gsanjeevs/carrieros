// server/infrastructure/supabase/invoice-write-repository.ts
// Invoice writes through the CALLER'S client, so RLS still applies. The org scope
// comes from the ActorContext.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { InvoiceDraftPatch, InvoiceSendRecord, InvoiceWriteRepository } from '../../ports'

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
    // Scope check first: the RPC re-checks org itself (it is now SECURITY DEFINER,
    // see migration 0033), but checking here too answers NOT_FOUND identically for
    // a cross-tenant id before spending an RPC round trip.
    const { data: owned } = await this.supabase.from('invoices').select('id').eq('id', invoiceId).eq('carrier_org_id', actor.orgId).maybeSingle()
    if (!owned) return err(domainError('NOT_FOUND', 'Invoice not found'))

    // Deterministic idempotency key: an invoice can only ever transition to 'paid'
    // once (the function itself is idempotent — status <> 'paid' — so a retried
    // mark-paid naturally targets the SAME business fact, and the outbox event for
    // it must therefore also be exactly-once for this invoice).
    const idempotencyKey = `invoice:${invoiceId}:paid`
    const { data, error } = await this.supabase.rpc('mark_invoice_paid', {
      p_invoice_id: invoiceId,
      p_paid_at: paidAt.toISOString(),
      p_correlation_id: actor.correlationId,
      p_idempotency_key: idempotencyKey,
    })
    if (error) {
      if (error.code === 'PT404') return err(domainError('NOT_FOUND', 'Invoice not found'))
      return err(domainError('PRECONDITION_FAILED', `mark paid failed: ${error.message}`))
    }
    const row = data as unknown as { outcome: 'APPLIED' | 'ALREADY_PAID' | 'REPLAYED'; invoice_id: number }
    const outcome = row.outcome === 'REPLAYED' ? 'ALREADY_PAID' : row.outcome
    return ok({ outcome, invoiceId: Number(row.invoice_id) })
  }

  // Mirrors lib/invoice-actions.ts's sendInvoiceAndMarkSent() select exactly
  // (same columns/joins) so the /api/v1 route behaves identically to the
  // legacy mobile route it replaces.
  async findForSend(actor: ActorContext, invoiceId: number): Promise<Result<InvoiceSendRecord | null>> {
    const { data, error } = await this.supabase
      .from('invoices')
      .select(`
        invoice_number, amount, due_date,
        loads ( load_number, tracking_token ),
        organizations!invoices_customer_org_id_fkey ( name, email )
      `)
      .eq('id', invoiceId)
      .eq('carrier_org_id', actor.orgId)
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `invoice lookup failed: ${error.message}`))
    if (!data) return ok(null)

    const customerOrg = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations
    const load = Array.isArray(data.loads) ? data.loads[0] : data.loads

    // Separate query (not folded into the select above) so the mirrored
    // legacy select shape stays byte-for-byte identical — this is the
    // carrier's own org (actor.orgId, already the findForSend filter),
    // not the customer org joined above. Rule I: never fall back to a
    // literal currency here — resolveCurrency() at the call site owns that.
    const { data: carrierOrg } = await this.supabase
      .from('organizations')
      .select('currency')
      .eq('id', actor.orgId)
      .maybeSingle()

    return ok({
      invoiceNumber: data.invoice_number,
      amount: data.amount,
      dueDate: data.due_date,
      recipient: customerOrg?.email ?? null,
      customerName: customerOrg?.name ?? null,
      loadTrackingToken: load?.tracking_token ?? null,
      currency: carrierOrg?.currency ?? null,
    })
  }

  // Same mark_invoice_sent_command RPC (atomic status flip + outbox event,
  // T19 readiness layer / migration 0033) as the legacy route, with the same
  // deterministic per-invoice idempotency key — an invoice only ever
  // transitions to 'sent' once from this path.
  async markSent(actor: ActorContext, invoiceId: number): Promise<Result<void>> {
    const idempotencyKey = `invoice:${invoiceId}:sent`
    const { error } = await this.supabase.rpc('mark_invoice_sent_command', {
      p_invoice_id: invoiceId,
      p_sent_at: new Date().toISOString(),
      p_correlation_id: actor.correlationId,
      p_idempotency_key: idempotencyKey,
    })
    if (error) {
      if (error.code === 'PT404') return err(domainError('NOT_FOUND', 'Invoice not found'))
      return err(domainError('PRECONDITION_FAILED', `mark sent failed: ${error.message}`))
    }
    return ok(undefined)
  }
}
