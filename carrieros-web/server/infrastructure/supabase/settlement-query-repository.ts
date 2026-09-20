// server/infrastructure/supabase/settlement-query-repository.ts
// Read side for driver_settlements, through the CALLER'S client (RLS
// applies): driverId non-null narrows to that driver's own rows
// (driver_own_settlements_select); null relies on org-wide staff access
// (owner_solo_finance_settlements_all) alone.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { SettlementQueryRepository, SettlementRecord } from '../../ports'

type Row = {
  id: number
  pay_method: string
  gross_revenue: number | null
  net_pay: number | null
  payment_status: string
  period_start: string
  period_end: string
  drivers: { driver_number: string; profiles: { first_name: string | null; last_name: string | null } | null } | null
}

export class SupabaseSettlementQueryRepository implements SettlementQueryRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listForActor(actor: ActorContext, driverId: number | null): Promise<Result<readonly SettlementRecord[]>> {
    let query = (this.supabase as unknown as SupabaseClient)
      .from('driver_settlements')
      .select('id, pay_method, gross_revenue, net_pay, payment_status, period_start, period_end, drivers(driver_number, profiles(first_name, last_name))')
      .eq('carrier_org_id', actor.orgId)
      .order('created_at', { ascending: false })
    if (driverId !== null) query = query.eq('driver_id', driverId)

    const { data, error } = await query
    if (error) return err(domainError('PRECONDITION_FAILED', `settlement list failed: ${error.message}`))
    const rows = (data ?? []) as unknown as Row[]
    return ok(
      rows.map((r) => ({
        id: Number(r.id),
        pay_method: r.pay_method,
        gross_revenue: r.gross_revenue,
        net_pay: r.net_pay,
        payment_status: r.payment_status,
        period_start: r.period_start,
        period_end: r.period_end,
        driver: r.drivers
          ? { driver_number: r.drivers.driver_number, first_name: r.drivers.profiles?.first_name ?? null, last_name: r.drivers.profiles?.last_name ?? null }
          : null,
      }))
    )
  }
}
