// server/application/field-actions-service.ts
// Small writes made from the road or the yard: mark chat messages read, share live location,
// update your own driver profile, log a vehicle service. Each states its role rule (mirroring
// today's RLS, which stays beneath it) and any domain rule the phone used to compute itself.
import { buildDriverProfilePatch, type DriverProfileInput } from '../domain/driver/self-profile'
import { buildServiceLog, nextDue, type ServiceLogInput } from '../domain/fleet/service-log'
import { ACTIVE_LOAD_STATUSES, validateLocation } from '../domain/messaging/location'
import { err, forbidden, notFound, ok, validationFailed, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { Clock, DriverSelfRepository, FleetRepository, IdempotencyRepository, LoadLocationRepository, MessageRepository, ShipmentAccessRepository } from '../ports'
import { withIdempotency } from './idempotency'
import { authorizeLoadAction } from './load-access'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

export class FieldActionsService {
  constructor(
    private readonly deps: {
      readonly shipments: ShipmentAccessRepository
      readonly messages: MessageRepository
      readonly locations: LoadLocationRepository
      readonly driverSelf: DriverSelfRepository
      readonly fleet: FleetRepository
      readonly idempotency: IdempotencyRepository
      readonly clock: Clock
    }
  ) {}

  async markMessagesRead(actor: ActorContext, loadId: number, messageIds: readonly number[]): Promise<Result<{ updated: number }>> {
    const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, 'chat_participate', 'read messages')
    if (!access.ok) return access
    const updated = await this.deps.messages.markRead(actor, loadId, messageIds, this.deps.clock.now())
    return updated.ok ? ok({ updated: updated.value }) : updated
  }

  async shareLocation(actor: ActorContext, loadId: number, sample: { latitude: number; longitude: number; recordedAt?: Date }): Promise<Result<void>> {
    const valid = validateLocation(sample.latitude, sample.longitude)
    if (!valid.ok) return valid
    const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, 'location_share', 'share location')
    if (!access.ok) return access
    if (!(ACTIVE_LOAD_STATUSES as readonly string[]).includes(access.value.load.status)) {
      return err(validationFailed('Location is only shared while a load is active', { status: 'NOT_ACTIVE' }))
    }
    const now = this.deps.clock.now()
    // A phone clock in the future would pin the "last seen" timestamp and make every later sample look stale.
    const recordedAt = sample.recordedAt && sample.recordedAt.getTime() <= now.getTime() + 5 * 60_000 ? sample.recordedAt : now
    return this.deps.locations.updateLocation(actor, loadId, { ...valid.value, recordedAt })
  }

  async updateOwnDriverProfile(actor: ActorContext, input: DriverProfileInput): Promise<Result<void>> {
    if (!roleHasCapability(actor.role, 'driver_profile_edit_own')) return err(forbidden('Only drivers edit a driver profile here', { role: actor.role }))
    const patch = buildDriverProfilePatch(input)
    if (!patch.ok) return patch
    if (patch.value.default_vehicle_id !== null) {
      const inOrg = await this.deps.driverSelf.vehicleInOrg(actor, patch.value.default_vehicle_id)
      if (!inOrg.ok) return inOrg
      if (!inOrg.value) return err(validationFailed('That vehicle is not in your organization', { default_vehicle_id: 'INVALID' }))
    }
    const updated = await this.deps.driverSelf.updateOwnProfile(actor, patch.value)
    if (!updated.ok) return updated
    return updated.value ? ok(undefined) : err(notFound('Driver record'))
  }

  async logVehicleService(
    actor: ActorContext,
    vehicleId: number,
    input: ServiceLogInput & { reminderId?: number | null },
    idempotencyKey: string
  ): Promise<Result<{ id: number }>> {
    if (!roleHasCapability(actor.role, 'service_log')) return err(forbidden('This role cannot log vehicle service', { role: actor.role }))
    const draft = buildServiceLog(input)
    if (!draft.ok) return draft

    return withIdempotency(this.deps.idempotency, actor, `POST /vehicles/${vehicleId}/service-logs`, idempotencyKey, input, async () => {
      let due: { nextDueDate: string | null; nextDueMiles: number | null } = { nextDueDate: null, nextDueMiles: null }
      if (input.reminderId != null) {
        const reminder = await this.deps.fleet.findReminder(actor, vehicleId, input.reminderId)
        if (!reminder.ok) return reminder
        if (!reminder.value) return err(notFound('Maintenance reminder'))
        due = nextDue(draft.value.serviceDate, draft.value.odometer, reminder.value)
      }
      return this.deps.fleet.logService(actor, {
        vehicleId,
        serviceType: draft.value.serviceType,
        serviceDate: draft.value.serviceDate,
        odometer: draft.value.odometer,
        cost: draft.value.cost,
        shopName: draft.value.shopName,
        notes: draft.value.notes,
        reminderId: input.reminderId ?? null,
        nextDueDate: due.nextDueDate,
        nextDueMiles: due.nextDueMiles,
      })
    })
  }
}
