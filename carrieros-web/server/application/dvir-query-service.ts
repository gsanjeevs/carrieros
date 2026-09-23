// server/application/dvir-query-service.ts
// Read use cases for DVIR: one load's inspections (the mobile DVIR flow's
// "has a pre-trip already been filed" check), and history (own inspections
// for a driver, the whole org for everyone else — mirrors mobile's existing
// dvir-history screen, which narrows to "mine" for drivers client-side today).
import { ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { DvirHistoryItem, DvirInspectionBrief, DvirQueryRepository, ShipmentAccessRepository } from '../ports'
import { authorizeLoadAction } from './load-access'

export class DvirQueryService {
  constructor(
    private readonly deps: {
      readonly dvir: DvirQueryRepository
      readonly shipments: ShipmentAccessRepository
    }
  ) {}

  async listForLoad(actor: ActorContext, loadId: number, type?: string): Promise<Result<readonly DvirInspectionBrief[]>> {
    const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, 'dvir_file', 'view inspections')
    if (!access.ok) return access
    return this.deps.dvir.listForLoad(actor, loadId, type)
  }

  async listForActor(actor: ActorContext): Promise<Result<readonly DvirHistoryItem[]>> {
    let driverId: number | null = null
    if (actor.role === 'driver') {
      const found = await this.deps.shipments.findDriverIdForActor(actor)
      if (!found.ok) return found
      driverId = found.value
      if (driverId === null) return ok([]) // a driver login with no driver record sees nothing
    }
    return this.deps.dvir.listForActor(actor, driverId)
  }
}
