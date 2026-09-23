// server/application/settlement-query-service.ts
// Read use case for settlements. Staff (settlements_manage: owner/solo/
// finance) see the whole org and additionally need the driver_settlements
// entitlement; a driver (settlements_view) sees only their own rows and is
// not entitlement-gated (their own already-computed pay never disappears
// behind a plan change). Dispatcher holds neither capability and is
// forbidden, matching driver_settlements' RLS exactly (no dispatcher policy
// exists at all).
import { err, forbidden, ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { FeatureGate, SettlementQueryRepository, SettlementRecord, ShipmentAccessRepository } from '../ports'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

const SETTLEMENTS_FEATURE_KEY = 'driver_settlements'

export class SettlementQueryService {
  constructor(
    private readonly deps: {
      readonly settlements: SettlementQueryRepository
      readonly shipments: ShipmentAccessRepository
      readonly features: FeatureGate
    }
  ) {}

  async list(actor: ActorContext): Promise<Result<{ entitled: boolean; settlements: readonly SettlementRecord[] }>> {
    const isStaff = roleHasCapability(actor.role, 'settlements_manage')
    if (!isStaff && !roleHasCapability(actor.role, 'settlements_view')) {
      return err(forbidden('This role cannot view settlements', { role: actor.role }))
    }

    if (isStaff) {
      const entitled = await this.deps.features.hasFeature(actor, SETTLEMENTS_FEATURE_KEY)
      if (!entitled.ok) return entitled
      if (!entitled.value) return ok({ entitled: false, settlements: [] })
      const rows = await this.deps.settlements.listForActor(actor, null)
      if (!rows.ok) return rows
      return ok({ entitled: true, settlements: rows.value })
    }

    // Driver: own rows only, no entitlement gate.
    const driverId = await this.deps.shipments.findDriverIdForActor(actor)
    if (!driverId.ok) return driverId
    if (driverId.value === null) return ok({ entitled: true, settlements: [] })
    const rows = await this.deps.settlements.listForActor(actor, driverId.value)
    if (!rows.ok) return rows
    return ok({ entitled: true, settlements: rows.value })
  }
}
