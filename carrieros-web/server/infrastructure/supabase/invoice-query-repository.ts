// server/infrastructure/supabase/invoice-query-repository.ts
// Read side for invoices, through the CALLER'S client (RLS applies), org
// scoped by actor.orgId.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { InvoiceDetailRecord, InvoiceQueryRepository, InvoiceSummaryRecord } from '../../ports'

export class SupabaseInvoiceQueryRepository implements InvoiceQueryRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listForOrg(actor: ActorContext): Promise<Result<readonly InvoiceSummaryRecord[]>> {
    const { data, error } = await this.supabase
      .from('invoices')
      .select('id, invoice_number, amount, status, due_date, opened_at')
      .eq('carrier_org_id', actor.orgId)
      .order('created_at', { ascending: false })
    if (error) return err(domainError('PRECONDITION_FAILED', `invoice list failed: ${error.message}`))
    return ok((data ?? []) as unknown as InvoiceSummaryRecord[])
  }

  async getForActor(actor: ActorContext, invoiceId: number): Promise<Result<InvoiceDetailRecord | null>> {
    const { data, error } = await this.supabase
      .from('invoices')
      .select('id, invoice_number, amount, status, due_date, notes, sent_at, paid_at, opened_at, load_id')
      .eq('id', invoiceId)
      .eq('carrier_org_id', actor.orgId)
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `invoice lookup failed: ${error.message}`))
    return ok(data ? (data as unknown as InvoiceDetailRecord) : null)
  }
}
