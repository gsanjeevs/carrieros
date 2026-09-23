// server/infrastructure/supabase/load-read-repository.ts
// Supabase adapter for LoadReadRepository. Two tenant/visibility rules live
// here because they are about data shape, not business policy:
//  * org scoping always uses actor.orgId (defence in depth beside RLS);
//  * drivers are restricted to their own loads and read the loads_driver_view,
//    which omits `rate` at the database level (decisions.md BR-1).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { getDriverIdForProfile } from '@/lib/queries/drivers'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { LoadDetail, LoadEvent, LoadSummary } from '../../domain/load/read-model'
import type { ListLoadsCriteria, LoadReadRepository } from '../../ports'

const BASE_COLUMNS =
  'id, load_number, status, customer_name_raw, pickup_city, pickup_state, delivery_city, delivery_state, pickup_date, delivery_date, commodity, driver_id'

const DETAIL_COLUMNS =
  'id, load_number, status, customer_name_raw, pickup_address, pickup_city, pickup_state, pickup_date, pickup_time, ' +
  'delivery_address, delivery_city, delivery_state, delivery_date, delivery_time, commodity, weight_lbs, total_miles, driver_id, vehicle_id'

export class SupabaseLoadReadRepository implements LoadReadRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listForActor(
    actor: ActorContext,
    criteria: ListLoadsCriteria
  ): Promise<Result<readonly LoadSummary[]>> {
    const isDriver = actor.role === 'driver'
    // A driver never selects rate, whatever the caller asked for.
    const withRate = criteria.includeRate && !isDriver

    let driverId: number | null = null
    if (isDriver) {
      const { data: driver } = await getDriverIdForProfile(this.supabase, actor.userId)
      if (!driver) return ok([]) // a driver login with no driver record sees nothing
      driverId = Number(driver.id)
    }

    // Untyped view of the client: the table/view is chosen at runtime, which
    // the generated Database typing cannot express as one call. The result is
    // mapped to LoadSummary below.
    let query = (this.supabase as unknown as SupabaseClient)
      .from(isDriver ? 'loads_driver_view' : 'loads')
      .select(withRate ? `${BASE_COLUMNS}, rate` : BASE_COLUMNS)
      .eq('carrier_org_id', actor.orgId)
      .order('created_at', { ascending: false })
      .limit(criteria.limit)

    if (driverId !== null) query = query.eq('driver_id', driverId)
    if (criteria.statuses && criteria.statuses.length > 0) query = query.in('status', [...criteria.statuses])

    const { data, error } = await query
    if (error) return err(domainError('PRECONDITION_FAILED', `load list query failed: ${error.message}`))
    return ok((data ?? []) as unknown as LoadSummary[])
  }

  async getDetailForActor(
    actor: ActorContext,
    loadId: number,
    includeRate: boolean
  ): Promise<Result<{ load: LoadDetail; events: readonly LoadEvent[] } | null>> {
    const isDriver = actor.role === 'driver'
    const withRate = includeRate && !isDriver

    let driverId: number | null = null
    if (isDriver) {
      const { data: driver } = await getDriverIdForProfile(this.supabase, actor.userId)
      if (!driver) return ok(null) // a driver login with no driver record sees nothing
      driverId = Number(driver.id)
    }

    let query = (this.supabase as unknown as SupabaseClient)
      .from(isDriver ? 'loads_driver_view' : 'loads')
      .select(withRate ? `${DETAIL_COLUMNS}, rate` : DETAIL_COLUMNS)
      .eq('id', loadId)
      .eq('carrier_org_id', actor.orgId)

    if (driverId !== null) query = query.eq('driver_id', driverId)

    const { data: loadRow, error: loadErr } = await query.maybeSingle()
    if (loadErr) return err(domainError('PRECONDITION_FAILED', `load detail query failed: ${loadErr.message}`))
    if (!loadRow) return ok(null)

    const { data: eventRows, error: eventsErr } = await this.supabase
      .from('load_events')
      .select('id, event_type, created_at')
      .eq('load_id', loadId)
      .order('created_at', { ascending: true })
    if (eventsErr) return err(domainError('PRECONDITION_FAILED', `load events query failed: ${eventsErr.message}`))

    return ok({ load: loadRow as unknown as LoadDetail, events: (eventRows ?? []) as unknown as LoadEvent[] })
  }
}
