// server/application/driver-action-service.ts
// Use cases a driver (or the owner-operator) performs against a load: log a fuel
// purchase, report a problem. Both are retry-safe via Idempotency-Key.
import { buildFuelStop, type FuelStopInput } from '../domain/driver-actions/fuel-stop'
import { buildProblemReport } from '../domain/driver-actions/problem-report'
import { isIssuedPath } from '../domain/documents/upload'
import { err, validationFailed, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { Clock, DriverActionRepository, IdempotencyRepository, ObjectStorage, ShipmentAccessRepository } from '../ports'
import { withIdempotency } from './idempotency'
import { authorizeLoadAction } from './load-access'

// Roles come from role_capabilities ('fuel_log', 'problem_report'), mirroring today's RLS: fuel_stops ->
// driver(own load)/owner/solo/dispatcher; exception_events driver reports -> driver(own load)/owner/solo.

export class DriverActionService {
  constructor(
    private readonly deps: {
      readonly shipments: ShipmentAccessRepository
      readonly actions: DriverActionRepository
      readonly idempotency: IdempotencyRepository
      readonly clock: Clock
      readonly storage: ObjectStorage
    }
  ) {}

  async logFuelStop(
    actor: ActorContext,
    loadId: number,
    input: FuelStopInput,
    idempotencyKey: string
  ): Promise<Result<{ id: number; totalCost: number }>> {
    const draft = buildFuelStop(input)
    if (!draft.ok) return draft

    return withIdempotency(this.deps.idempotency, actor, `POST /loads/${loadId}/fuel-stops`, idempotencyKey, input, async () => {
      const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, 'fuel_log', 'log fuel')
      if (!access.ok) return access
      const { load, actorDriverId } = access.value

      const created = await this.deps.actions.createFuelStop(actor, load, {
        state: draft.value.state,
        station: draft.value.station,
        gallons: draft.value.gallons,
        pricePerGallon: draft.value.pricePerGallon,
        totalCost: draft.value.totalCost,
        odometer: draft.value.odometer,
        stopDate: draft.value.stopDate ?? this.deps.clock.now().toISOString().slice(0, 10),
        // A driver logs against themselves (RLS requires it); anyone else logs against the load's driver.
        driverId: actor.role === 'driver' ? actorDriverId : load.driverId,
      })
      if (!created.ok) return created
      return { ok: true as const, value: { id: created.value.id, totalCost: draft.value.totalCost } }
    })
  }

  /** A load's fuel stops. Same 'fuel_log' gate as logFuelStop. */
  async listFuelStops(actor: ActorContext, loadId: number) {
    const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, 'fuel_log', 'view fuel stops')
    if (!access.ok) return access
    return this.deps.actions.listFuelStopsForLoad(actor, loadId)
  }

  /** Verifies the uploaded object is really at the claimed (issued) path, then attaches it to an
   * already-created fuel stop. The signed upload slot itself is requested through the existing
   * generic POST /loads/{id}/document-uploads (type 'fuel_receipt') -- 'documents_upload' and
   * 'fuel_log' are held by the exact same role set today, so a second signing endpoint would just
   * duplicate DocumentService.requestUpload for no real gating difference. Only the finalize step
   * needs to be different, since a fuel receipt is 1:1 with an already-created fuel_stops row, not
   * one of a load's many listed documents. Mirrors DocumentService.finalize's verification exactly. */
  async attachFuelStopReceipt(actor: ActorContext, loadId: number, fuelStopId: number, storagePath: string): Promise<Result<boolean>> {
    const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, 'fuel_log', 'attach a fuel receipt')
    if (!access.ok) return access

    if (!isIssuedPath(storagePath, actor.orgId, loadId, 'fuel_receipt')) {
      return err(validationFailed('That path was not issued for this load', { storage_path: 'NOT_ISSUED' }))
    }
    const present = await this.deps.storage.exists(storagePath)
    if (!present.ok) return present
    if (!present.value) return err(validationFailed('No uploaded file found at that path', { storage_path: 'UPLOAD_NOT_FOUND' }))

    return this.deps.actions.attachFuelStopReceipt(actor, loadId, fuelStopId, storagePath)
  }

  async reportProblem(
    actor: ActorContext,
    loadId: number,
    input: { reason: string; note?: string | null },
    idempotencyKey: string
  ): Promise<Result<{ id: number }>> {
    const draft = buildProblemReport(input.reason, input.note)
    if (!draft.ok) return draft

    return withIdempotency(this.deps.idempotency, actor, `POST /loads/${loadId}/problem-reports`, idempotencyKey, input, async () => {
      const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, 'problem_report', 'report a problem')
      if (!access.ok) return access
      return this.deps.actions.createProblemReport(actor, access.value.load, {
        eventType: 'driver_reported_problem',
        severity: 'urgent',
        title: draft.value.title,
        detail: draft.value.detail,
      })
    })
  }
}
