// server/application/fleet-query-service.ts
// Read use cases for the fleet screens (mobile Fleet tab, vehicle detail, and
// a driver's own default-vehicle picker on driver-profile): which vehicles an
// org has, and one vehicle's service history and open maintenance reminders.
// Unlike the write side (`service_log`, owner/solo only), reading these three
// tables has no role restriction in RLS (`carrier_vehicles_select` etc. are
// plain org-scoped SELECTs) — a driver picking their default vehicle, or
// looking up a load's assigned truck, needs the same read access an
// owner/solo/dispatcher gets. Org scoping (actor.orgId) is enforced by the
// repository, same as everywhere else.
import { ok, err, notFound, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { FleetQueryRepository, FleetReminderRecord, MaintenanceReminderRecord, ServiceLogRecord } from '../ports'

export interface VehicleSummaryOutput {
  readonly id: number
  readonly vehicle_number: string | null
  readonly nickname: string
  readonly status: string
  readonly photo_url: string | null
}

export class FleetQueryService {
  constructor(
    private readonly deps: {
      readonly fleet: FleetQueryRepository
      readonly signPhoto: (photoPath: string) => Promise<string | null>
    }
  ) {}

  async list(actor: ActorContext): Promise<Result<readonly VehicleSummaryOutput[]>> {
    const rows = await this.deps.fleet.listActiveForOrg(actor)
    if (!rows.ok) return rows
    const withUrls = await Promise.all(
      rows.value.map(async (v) => ({
        id: v.id,
        vehicle_number: v.vehicle_number,
        nickname: v.nickname,
        status: v.status,
        photo_url: v.photo_path ? await this.deps.signPhoto(v.photo_path) : null,
      }))
    )
    return ok(withUrls)
  }

  /** Fleet-wide reminders. Org scoped only, matching `carrier_reminders_select` — same
   * "no extra capability gate beyond org scoping" posture as list()/getDetail() above. */
  async listReminders(actor: ActorContext): Promise<Result<readonly FleetReminderRecord[]>> {
    return this.deps.fleet.listActiveReminders(actor)
  }

  async getDetail(
    actor: ActorContext,
    vehicleId: number
  ): Promise<Result<{ id: number; vehicle_number: string | null; nickname: string; status: string; service_logs: readonly ServiceLogRecord[]; maintenance_reminders: readonly MaintenanceReminderRecord[] }>> {
    const found = await this.deps.fleet.getDetailForActor(actor, vehicleId)
    if (!found.ok) return found
    if (!found.value) return err(notFound('Vehicle'))
    const { vehicle, serviceLogs, reminders } = found.value
    return ok({
      id: vehicle.id,
      vehicle_number: vehicle.vehicle_number,
      nickname: vehicle.nickname,
      status: vehicle.status,
      service_logs: serviceLogs,
      maintenance_reminders: reminders,
    })
  }
}
