// server/infrastructure/supabase/ifta-repository.ts
// IFTA writes and the entitlement lookup, through the caller's client (RLS applies; has_feature reads the caller's own tier).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, validationFailed, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { FeatureGate, IftaRepository, ShipmentAccess } from '../../ports'

export class SupabaseFeatureGate implements FeatureGate {
  constructor(private readonly supabase: SupabaseClient<Database>) {}
  async hasFeature(_actor: ActorContext, featureKey: string): Promise<Result<boolean>> {
    const { data, error } = await this.supabase.rpc('has_feature', { feature_key: featureKey })
    if (error) return err(domainError('PRECONDITION_FAILED', `entitlement check failed: ${error.message}`))
    return ok(data === true)
  }
}

export class SupabaseIftaRepository implements IftaRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async insertGpsCrossing(actor: ActorContext, load: ShipmentAccess, r: Parameters<IftaRepository['insertGpsCrossing']>[2]): Promise<Result<{ id: number }>> {
    const { data, error } = await this.supabase
      .from('ifta_state_crossings')
      .insert({
        carrier_org_id: actor.orgId,
        vehicle_id: load.vehicleId,
        driver_id: r.driverId,
        load_id: load.id,
        state: r.state,
        crossed_at: r.crossedAt.toISOString(),
        lat: r.latitude,
        lng: r.longitude,
        source: 'gps',
      })
      .select('id')
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `crossing insert failed: ${error.message}`))
    // A driver may INSERT but not SELECT the row back under RLS, so an absent id is not a failure.
    return ok({ id: data ? Number(data.id) : 0 })
  }

  async replaceWithManual(_actor: ActorContext, loadId: number, rows: readonly { state: string; miles: number }[]): Promise<Result<number>> {
    const { data, error } = await this.supabase.rpc('replace_ifta_crossings_with_manual', { p_load_id: loadId, p_rows: rows as never })
    if (error) {
      if (error.code === 'PT404') return err(domainError('NOT_FOUND', 'Load not found'))
      if (error.code === 'PT400') return err(validationFailed(error.message.replace(/^VALIDATION: /, '')))
      return err(domainError('PRECONDITION_FAILED', `replace crossings failed: ${error.message}`))
    }
    return ok(Number(data))
  }
}
