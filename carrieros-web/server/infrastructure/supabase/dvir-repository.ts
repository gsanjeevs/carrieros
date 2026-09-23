// server/infrastructure/supabase/dvir-repository.ts
// DVIR persistence through the CALLER'S client (RLS applies), org from the ActorContext.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { getDriverIdForProfile } from '@/lib/queries/drivers'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { DvirRepository, InspectionAccess } from '../../ports'

export class SupabaseDvirRepository implements DvirRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async findDefaultVehicle(actor: ActorContext): Promise<Result<number | null>> {
    const { data } = await getDriverIdForProfile(this.supabase, actor.userId)
    return ok(data?.default_vehicle_id == null ? null : Number(data.default_vehicle_id))
  }

  async submit(actor: ActorContext, i: Parameters<DvirRepository['submit']>[1]): Promise<Result<{ id: number; defects: readonly { id: number; area: string }[] }>> {
    const { data, error } = await this.supabase.rpc('submit_dvir_inspection', {
      p_load_id: i.loadId,
      p_vehicle_id: i.vehicleId as number,
      p_driver_id: i.driverId as number,
      p_type: i.type,
      p_condition: i.condition,
      p_odometer: i.odometer as number,
      p_defects: i.defects as never,
    })
    if (error) {
      if (error.code === 'PT404') return err(domainError('NOT_FOUND', 'Load not found'))
      return err(domainError('PRECONDITION_FAILED', `submit inspection failed: ${error.message}`))
    }
    const row = data as unknown as { id: number; defects: { id: number; area: string }[] }
    return ok({ id: Number(row.id), defects: row.defects.map((d) => ({ id: Number(d.id), area: d.area })) })
  }

  async findInspection(actor: ActorContext, inspectionId: number): Promise<Result<InspectionAccess | null>> {
    const { data, error } = await this.supabase.from('dvir_inspections').select('id, driver_id').eq('id', inspectionId).eq('carrier_org_id', actor.orgId).maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `inspection lookup failed: ${error.message}`))
    return ok(data ? { id: Number(data.id), driverId: data.driver_id == null ? null : Number(data.driver_id) } : null)
  }

  async attach(actor: ActorContext, inspectionId: number, target: Parameters<DvirRepository['attach']>[2], storagePath: string): Promise<Result<boolean>> {
    if (target.kind === 'signature') {
      const { data, error } = await this.supabase.from('dvir_inspections').update({ signature_url: storagePath }).eq('id', inspectionId).eq('carrier_org_id', actor.orgId).select('id')
      if (error) return err(domainError('PRECONDITION_FAILED', `attach signature failed: ${error.message}`))
      return ok((data ?? []).length > 0)
    }
    const { data, error } = await this.supabase.from('dvir_defects').update({ photo_path: storagePath }).eq('inspection_id', inspectionId).eq('area', target.area).select('id')
    if (error) return err(domainError('PRECONDITION_FAILED', `attach photo failed: ${error.message}`))
    return ok((data ?? []).length > 0)
  }
}
