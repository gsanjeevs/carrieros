// server/infrastructure/supabase/fleet-query-repository.ts
// Read side for vehicles, through the CALLER'S client (RLS applies), org scoped
// by actor.orgId. Photo signed URLs are minted here (server-side), not by the
// client reading a private bucket's public URL.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { createStorageProvider } from '@/lib/storage'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { FleetQueryRepository, MaintenanceReminderRecord, ServiceLogRecord, VehicleSummaryRecord } from '../../ports'

const PHOTO_URL_TTL_SECONDS = 3600

export class SupabaseFleetQueryRepository implements FleetQueryRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listActiveForOrg(actor: ActorContext): Promise<Result<readonly VehicleSummaryRecord[]>> {
    const { data, error } = await this.supabase
      .from('vehicles')
      .select('id, vehicle_number, nickname, status, photo_path')
      .eq('carrier_org_id', actor.orgId)
      .eq('is_active', true)
      .order('vehicle_number', { ascending: true })
    if (error) return err(domainError('PRECONDITION_FAILED', `vehicle list failed: ${error.message}`))
    return ok((data ?? []) as unknown as VehicleSummaryRecord[])
  }

  async getDetailForActor(
    actor: ActorContext,
    vehicleId: number
  ): Promise<Result<{ vehicle: VehicleSummaryRecord; serviceLogs: readonly ServiceLogRecord[]; reminders: readonly MaintenanceReminderRecord[] } | null>> {
    const { data: vehicle, error: vehicleErr } = await this.supabase
      .from('vehicles')
      .select('id, vehicle_number, nickname, status, photo_path')
      .eq('id', vehicleId)
      .eq('carrier_org_id', actor.orgId)
      .maybeSingle()
    if (vehicleErr) return err(domainError('PRECONDITION_FAILED', `vehicle lookup failed: ${vehicleErr.message}`))
    if (!vehicle) return ok(null)

    const [{ data: logs, error: logsErr }, { data: reminders, error: remindersErr }] = await Promise.all([
      this.supabase
        .from('service_logs')
        .select('id, service_type, service_date, odometer, cost, shop_name')
        .eq('vehicle_id', vehicleId)
        .eq('carrier_org_id', actor.orgId)
        .order('service_date', { ascending: false }),
      this.supabase
        .from('maintenance_reminders')
        .select('id, trigger_months, trigger_miles, reminder_type')
        .eq('vehicle_id', vehicleId)
        .eq('carrier_org_id', actor.orgId)
        .eq('is_active', true),
    ])
    if (logsErr) return err(domainError('PRECONDITION_FAILED', `service log list failed: ${logsErr.message}`))
    if (remindersErr) return err(domainError('PRECONDITION_FAILED', `reminder list failed: ${remindersErr.message}`))

    return ok({
      vehicle: vehicle as unknown as VehicleSummaryRecord,
      serviceLogs: (logs ?? []) as unknown as ServiceLogRecord[],
      reminders: ((reminders ?? []) as unknown as { id: number; trigger_months: number | null; trigger_miles: number | null; reminder_type: string }[]).map((r) => ({
        id: Number(r.id),
        reminderType: r.reminder_type,
        triggerMonths: r.trigger_months,
        triggerMiles: r.trigger_miles,
      })),
    })
  }

  async photoUrl(photoPath: string): Promise<string | null> {
    const provider = createStorageProvider(this.supabase)
    try {
      return await provider.getSignedUrl(photoPath, PHOTO_URL_TTL_SECONDS)
    } catch {
      return null
    }
  }
}
