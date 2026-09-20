// server/infrastructure/supabase/customer-query-repository.ts
// Read side for customers, through the CALLER'S client (RLS applies), org
// scoped by actor.orgId. customer_details has two FKs to organizations (its
// own carrier_org_id and this org_id), so every embed needs the explicit
// `customer_details_org_id_fkey` hint or PostgREST returns an ambiguous-
// relationship error (300/silently-empty) — same fix mobile's screens and
// web's customers/page.tsx already carry.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { CustomerDetailRecord, CustomerLoadRecord, CustomerQueryRepository, CustomerSummaryRecord } from '../../ports'

type OrgEmbed = { name: string; phone: string | null; email: string | null; city?: string | null; state?: string | null }

export class SupabaseCustomerQueryRepository implements CustomerQueryRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listForOrg(actor: ActorContext): Promise<Result<readonly CustomerSummaryRecord[]>> {
    const { data, error } = await (this.supabase as unknown as SupabaseClient)
      .from('customer_details')
      .select('org_id, contact_name, organizations!customer_details_org_id_fkey(name, phone, email)')
      .eq('carrier_org_id', actor.orgId)
      .order('org_id', { ascending: true })
    if (error) return err(domainError('PRECONDITION_FAILED', `customer list failed: ${error.message}`))
    const rows = (data ?? []) as unknown as { org_id: number; contact_name: string | null; organizations: OrgEmbed | null }[]
    return ok(
      rows.map((r) => ({
        org_id: Number(r.org_id),
        contact_name: r.contact_name,
        organization: r.organizations ? { name: r.organizations.name, phone: r.organizations.phone, email: r.organizations.email } : null,
      }))
    )
  }

  async getForActor(actor: ActorContext, customerOrgId: number): Promise<Result<CustomerDetailRecord | null>> {
    const { data, error } = await (this.supabase as unknown as SupabaseClient)
      .from('customer_details')
      .select('org_id, customer_number, contact_name, tags, notes, organizations!customer_details_org_id_fkey(name, phone, email, city, state)')
      .eq('org_id', customerOrgId)
      .eq('carrier_org_id', actor.orgId)
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `customer lookup failed: ${error.message}`))
    if (!data) return ok(null)
    const row = data as unknown as {
      org_id: number
      customer_number: string | null
      contact_name: string | null
      tags: string[] | null
      notes: string | null
      organizations: OrgEmbed | null
    }
    return ok({
      org_id: Number(row.org_id),
      customer_number: row.customer_number,
      contact_name: row.contact_name,
      tags: row.tags,
      notes: row.notes,
      organization: row.organizations
        ? { name: row.organizations.name, phone: row.organizations.phone, email: row.organizations.email, city: row.organizations.city ?? null, state: row.organizations.state ?? null }
        : null,
    })
  }

  async recentLoadsForCustomer(actor: ActorContext, customerOrgId: number, limit: number): Promise<Result<readonly CustomerLoadRecord[]>> {
    const { data, error } = await this.supabase
      .from('loads')
      .select('id, load_number, status, rate, delivery_date')
      .eq('customer_org_id', customerOrgId)
      .eq('carrier_org_id', actor.orgId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return err(domainError('PRECONDITION_FAILED', `customer loads failed: ${error.message}`))
    return ok((data ?? []) as unknown as CustomerLoadRecord[])
  }

  async healthScore(_actor: ActorContext, customerOrgId: number): Promise<Result<number | null>> {
    const { data, error } = await this.supabase.rpc('get_customer_health_score', { customer_org_id: customerOrgId })
    if (error) return err(domainError('PRECONDITION_FAILED', `health score failed: ${error.message}`))
    return ok(data != null ? Number(data) : null)
  }
}
