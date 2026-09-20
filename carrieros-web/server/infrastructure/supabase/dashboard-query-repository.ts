// server/infrastructure/supabase/dashboard-query-repository.ts
// Read side for the four role-branched dashboard contents (owner/solo,
// solo's own active load, dispatcher ops board, finance summary), through
// the CALLER'S client (RLS applies), org scoped by actor.orgId throughout.
// Every method here existed already as an inline query on mobile's
// (tabs)/home.tsx; this just centralizes them behind one authorization
// boundary instead of five unscoped direct table reads.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { getDriverIdForProfile } from '@/lib/queries/drivers'
import { ACTIVE_LOAD_STATUSES } from '../../domain/messaging/location'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { DashboardInvoiceRecord, DashboardLoadRecord, DashboardOpsLoad, DashboardQueryRepository } from '../../ports'

const SUMMARY_COLUMNS = 'id, load_number, status, customer_name_raw, pickup_city, pickup_state, delivery_city, delivery_state'

export class SupabaseDashboardQueryRepository implements DashboardQueryRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async activeLoadsCount(actor: ActorContext): Promise<Result<number>> {
    const { count, error } = await this.supabase
      .from('loads')
      .select('id', { count: 'exact', head: true })
      .eq('carrier_org_id', actor.orgId)
      .in('status', ACTIVE_LOAD_STATUSES)
    if (error) return err(domainError('PRECONDITION_FAILED', `active load count failed: ${error.message}`))
    return ok(count ?? 0)
  }

  async fleetStatusCounts(actor: ActorContext): Promise<Result<{ active: number; idle: number; in_shop: number }>> {
    const { data, error } = await this.supabase.from('vehicles').select('status').eq('carrier_org_id', actor.orgId).eq('is_active', true)
    if (error) return err(domainError('PRECONDITION_FAILED', `fleet status failed: ${error.message}`))
    const counts = { active: 0, idle: 0, in_shop: 0 }
    for (const v of data ?? []) {
      if (v.status === 'active') counts.active++
      else if (v.status === 'idle') counts.idle++
      else if (v.status === 'in_shop') counts.in_shop++
    }
    return ok(counts)
  }

  async recentLoads(actor: ActorContext, limit: number): Promise<Result<readonly DashboardLoadRecord[]>> {
    const { data, error } = await this.supabase
      .from('loads')
      .select(SUMMARY_COLUMNS)
      .eq('carrier_org_id', actor.orgId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return err(domainError('PRECONDITION_FAILED', `recent loads failed: ${error.message}`))
    return ok((data ?? []) as unknown as DashboardLoadRecord[])
  }

  async ownActiveLoad(actor: ActorContext): Promise<Result<DashboardLoadRecord | null>> {
    const { data: driver } = await getDriverIdForProfile(this.supabase, actor.userId)
    if (!driver) return ok(null)

    const { data, error } = await (this.supabase as unknown as SupabaseClient)
      .from('loads_driver_view')
      .select(SUMMARY_COLUMNS)
      .eq('carrier_org_id', actor.orgId)
      .eq('driver_id', driver.id)
      .in('status', ACTIVE_LOAD_STATUSES)
      .order('created_at', { ascending: false })
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `own active load failed: ${error.message}`))
    return ok((data as unknown as DashboardLoadRecord | null) ?? null)
  }

  async opsLoads(actor: ActorContext): Promise<Result<readonly DashboardOpsLoad[]>> {
    const { data, error } = await this.supabase
      .from('loads')
      .select(`${SUMMARY_COLUMNS}, driver_id, vehicle_id, updated_at`)
      .eq('carrier_org_id', actor.orgId)
      .in('status', ACTIVE_LOAD_STATUSES)
      .order('updated_at', { ascending: true })
    if (error) return err(domainError('PRECONDITION_FAILED', `ops loads failed: ${error.message}`))
    return ok((data ?? []) as unknown as DashboardOpsLoad[])
  }

  async availableDriversCount(actor: ActorContext, assignedDriverIds: readonly number[]): Promise<Result<number>> {
    let query = this.supabase.from('drivers').select('id').eq('carrier_org_id', actor.orgId).eq('is_active', true)
    if (assignedDriverIds.length > 0) query = query.not('id', 'in', `(${assignedDriverIds.join(',')})`)
    const { data, error } = await query
    if (error) return err(domainError('PRECONDITION_FAILED', `available drivers failed: ${error.message}`))
    return ok((data ?? []).length)
  }

  async availableVehiclesCount(actor: ActorContext, assignedVehicleIds: readonly number[]): Promise<Result<number>> {
    let query = this.supabase.from('vehicles').select('id').eq('carrier_org_id', actor.orgId).eq('is_active', true).eq('status', 'active')
    if (assignedVehicleIds.length > 0) query = query.not('id', 'in', `(${assignedVehicleIds.join(',')})`)
    const { data, error } = await query
    if (error) return err(domainError('PRECONDITION_FAILED', `available vehicles failed: ${error.message}`))
    return ok((data ?? []).length)
  }

  async outstandingInvoices(actor: ActorContext): Promise<Result<readonly { amount: number }[]>> {
    const { data, error } = await this.supabase.from('invoices').select('amount').eq('carrier_org_id', actor.orgId).in('status', ['sent', 'overdue'])
    if (error) return err(domainError('PRECONDITION_FAILED', `outstanding invoices failed: ${error.message}`))
    return ok((data ?? []).map((r) => ({ amount: Number(r.amount ?? 0) })))
  }

  async overdueInvoices(actor: ActorContext, limit: number): Promise<Result<readonly DashboardInvoiceRecord[]>> {
    const { data, error } = await this.supabase
      .from('invoices')
      .select('id, invoice_number, amount, due_date, paid_at')
      .eq('carrier_org_id', actor.orgId)
      .in('status', ['sent', 'overdue'])
      .order('due_date', { ascending: true })
      .limit(limit)
    if (error) return err(domainError('PRECONDITION_FAILED', `overdue invoices failed: ${error.message}`))
    return ok((data ?? []) as unknown as DashboardInvoiceRecord[])
  }

  async recentPayments(actor: ActorContext, limit: number): Promise<Result<readonly DashboardInvoiceRecord[]>> {
    const { data, error } = await this.supabase
      .from('invoices')
      .select('id, invoice_number, amount, due_date, paid_at')
      .eq('carrier_org_id', actor.orgId)
      .eq('status', 'paid')
      .order('paid_at', { ascending: false })
      .limit(limit)
    if (error) return err(domainError('PRECONDITION_FAILED', `recent payments failed: ${error.message}`))
    return ok((data ?? []) as unknown as DashboardInvoiceRecord[])
  }
}
