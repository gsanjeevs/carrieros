// server/infrastructure/supabase/load-write-repository.ts
// Load create/assign writes through the CALLER'S client, so RLS still
// applies. Mirrors app/api/loads/route.ts POST and app/api/loads/[id]/route.ts
// PATCH exactly - plain inserts/updates, no outbox event (load creation and
// assignment are not financial events tracked by the T19 readiness layer).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { generateLoadNumber } from '@/lib/generate-number'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { LoadAssignmentPatch } from '../../domain/load/write'
import type { CreateLoadRecord, LoadWriteRepository } from '../../ports'

export class SupabaseLoadWriteRepository implements LoadWriteRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async create(actor: ActorContext, record: CreateLoadRecord): Promise<Result<{ id: number; loadNumber: string }>> {
    // Only after the caller validated the body - next_entity_val() burns a
    // sequence value on every call, so a rejected request must not consume one.
    const loadNumber = await generateLoadNumber(this.supabase, actor.orgId)
    const { data, error } = await this.supabase
      .from('loads')
      .insert({ carrier_org_id: actor.orgId, load_number: loadNumber, status: 'draft', ...record })
      .select('id, load_number')
      .single()
    if (error || !data) return err(domainError('PRECONDITION_FAILED', `load create failed: ${error?.message ?? 'No row returned'}`))
    return ok({ id: Number(data.id), loadNumber: data.load_number })
  }

  async assign(actor: ActorContext, loadId: number, patch: LoadAssignmentPatch): Promise<Result<boolean>> {
    const update: { driver_id?: number | null; vehicle_id?: number | null; status?: string } = {}
    if (patch.driverId !== undefined) update.driver_id = patch.driverId
    if (patch.vehicleId !== undefined) update.vehicle_id = patch.vehicleId
    if (patch.status !== undefined) update.status = patch.status

    const { data, error } = await this.supabase
      .from('loads')
      .update(update)
      .eq('id', loadId)
      .eq('carrier_org_id', actor.orgId)
      .select('id')
    // 23514: the tenancy trigger (migration 0019) refused an id that isn't this carrier's.
    if (error?.code === '23514') return err(domainError('VALIDATION_FAILED', 'That driver or vehicle is not part of your fleet'))
    if (error) return err(domainError('PRECONDITION_FAILED', `load assign failed: ${error.message}`))
    return ok((data ?? []).length > 0)
  }

  async appendStatusEvent(actor: ActorContext, loadId: number, status: string): Promise<Result<void>> {
    const { error } = await this.supabase.from('load_events').insert({
      load_id: loadId,
      event_type: `status_${status}`,
      created_by: actor.userId,
    })
    if (error) return err(domainError('PRECONDITION_FAILED', `load event insert failed: ${error.message}`))
    return ok(undefined)
  }

  async dispatchRecipient(actor: ActorContext, loadId: number): Promise<Result<{ pushToken: string | null; loadNumber: string } | null>> {
    const { data: load, error: loadError } = await this.supabase
      .from('loads')
      .select('load_number, driver_id')
      .eq('id', loadId)
      .eq('carrier_org_id', actor.orgId)
      .maybeSingle()
    if (loadError) return err(domainError('PRECONDITION_FAILED', `load lookup failed: ${loadError.message}`))
    if (!load) return ok(null)
    if (!load.driver_id) return ok({ pushToken: null, loadNumber: load.load_number })

    const { data: driver, error: driverError } = await this.supabase
      .from('drivers')
      .select('profiles(push_token)')
      .eq('id', load.driver_id)
      .maybeSingle()
    if (driverError) return err(domainError('PRECONDITION_FAILED', `driver lookup failed: ${driverError.message}`))
    const profile = Array.isArray(driver?.profiles) ? driver.profiles[0] : driver?.profiles
    return ok({ pushToken: profile?.push_token ?? null, loadNumber: load.load_number })
  }

  async iftaMileageComplete(actor: ActorContext, loadId: number): Promise<Result<boolean | null>> {
    const { data, error } = await this.supabase.rpc('check_ifta_completeness', { p_load_id: loadId })
    if (error) return err(domainError('PRECONDITION_FAILED', `completeness check failed: ${error.message}`))
    return ok(data === true)
  }
}
