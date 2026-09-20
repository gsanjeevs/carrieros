// server/application/ifta-service.ts
// Recording IFTA state mileage: a GPS crossing captured by the phone, and the manual override.
// Both are gated on the ifta_mileage_log entitlement HERE, server-side; previously only the phone
// decided whether to show the feature, so a client that skipped that check could write anyway.
import { IFTA_FEATURE_KEY, validateGpsCrossing, validateManualRows, type GpsCrossingInput } from '../domain/compliance/ifta'
import { domainError, err, ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { Clock, FeatureGate, IdempotencyRepository, IftaRepository, ShipmentAccessRepository } from '../ports'
import { withIdempotency } from './idempotency'
import { authorizeLoadAction } from './load-access'

// Mirrors RLS: owner/solo/dispatcher (ALL) and drivers (INSERT on their own driver id).
const MAY_RECORD = new Set(['owner', 'solo', 'dispatcher', 'driver'])

export class IftaService {
  constructor(
    private readonly deps: {
      readonly shipments: ShipmentAccessRepository
      readonly ifta: IftaRepository
      readonly features: FeatureGate
      readonly idempotency: IdempotencyRepository
      readonly clock: Clock
    }
  ) {}

  private async requireEntitlement(actor: ActorContext): Promise<Result<void>> {
    const entitled = await this.deps.features.hasFeature(actor, IFTA_FEATURE_KEY)
    if (!entitled.ok) return entitled
    if (!entitled.value) return err(domainError('ENTITLEMENT_REQUIRED', 'IFTA mileage logging is not part of this plan', { meta: { feature: IFTA_FEATURE_KEY } }))
    return ok(undefined)
  }

  async recordGpsCrossing(actor: ActorContext, loadId: number, input: GpsCrossingInput, idempotencyKey: string): Promise<Result<{ id: number }>> {
    const draft = validateGpsCrossing(input, this.deps.clock.now())
    if (!draft.ok) return draft

    return withIdempotency(this.deps.idempotency, actor, `POST /loads/${loadId}/ifta-crossings`, idempotencyKey, { ...input, crossedAt: input.crossedAt.toISOString() }, async () => {
      const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, MAY_RECORD, 'record IFTA mileage')
      if (!access.ok) return access
      const gate = await this.requireEntitlement(actor)
      if (!gate.ok) return gate
      return this.deps.ifta.insertGpsCrossing(actor, access.value.load, {
        ...draft.value,
        driverId: actor.role === 'driver' ? access.value.actorDriverId : access.value.load.driverId,
      })
    })
  }

  async replaceWithManual(actor: ActorContext, loadId: number, rows: readonly { state: string; miles: number }[]): Promise<Result<{ written: number }>> {
    const valid = validateManualRows(rows)
    if (!valid.ok) return valid
    const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, MAY_RECORD, 'record IFTA mileage')
    if (!access.ok) return access
    const gate = await this.requireEntitlement(actor)
    if (!gate.ok) return gate
    const written = await this.deps.ifta.replaceWithManual(actor, loadId, valid.value)
    return written.ok ? ok({ written: written.value }) : written
  }
}
