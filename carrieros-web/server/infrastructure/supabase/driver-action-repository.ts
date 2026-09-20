// server/infrastructure/supabase/driver-action-repository.ts
// Inserts for driver actions, through the CALLER'S client so RLS still applies
// beneath the application-layer checks. Every org/actor column comes from the
// ActorContext, never from request input.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { DriverActionRepository, FuelStopRecord, ProblemReportRecord, ShipmentAccess } from '../../ports'

export class SupabaseDriverActionRepository implements DriverActionRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async createFuelStop(actor: ActorContext, load: ShipmentAccess, record: FuelStopRecord): Promise<Result<{ id: number }>> {
    const { data, error } = await this.supabase
      .from('fuel_stops')
      .insert({
        carrier_org_id: actor.orgId,
        load_id: load.id,
        vehicle_id: load.vehicleId,
        driver_id: record.driverId,
        state: record.state,
        station: record.station,
        stop_date: record.stopDate,
        gallons: record.gallons,
        price_per_gallon: record.pricePerGallon,
        total_cost: record.totalCost,
        odometer: record.odometer,
        logged_by: actor.userId,
      })
      .select('id')
      .single()
    if (error || !data) return err(domainError('PRECONDITION_FAILED', `fuel stop insert failed: ${error?.message}`))
    return ok({ id: Number(data.id) })
  }

  async createProblemReport(actor: ActorContext, load: ShipmentAccess, record: ProblemReportRecord): Promise<Result<{ id: number }>> {
    // exception_events grants no SELECT-after-insert to a driver, so no .select()
    // here; the id comes back via the insert's own return only when RLS permits reads.
    const { data, error } = await this.supabase
      .from('exception_events')
      .insert({
        carrier_org_id: actor.orgId,
        entity_type: 'load',
        entity_id: load.id,
        event_type: record.eventType,
        severity: record.severity,
        title: record.title,
        detail: record.detail,
      })
      .select('id')
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `problem report insert failed: ${error.message}`))
    return ok({ id: data ? Number(data.id) : 0 })
  }
}
