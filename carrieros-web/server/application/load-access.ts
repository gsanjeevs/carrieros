// server/application/load-access.ts
// "May this actor act on this load?" answered once for every command that targets
// one load (advance status, log fuel, report a problem). It exists because the
// database functions/inserts beneath some commands bypass or only partly mirror
// RLS: the application layer is where the rule is stated and tested.
import { err, forbidden, notFound, ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { ShipmentAccess, ShipmentAccessRepository } from '../ports'

export async function authorizeLoadAction(
  shipments: ShipmentAccessRepository,
  actor: ActorContext,
  loadId: number,
  /** Roles allowed to perform this action at all. `driver` is further limited to their own load. */
  allowedRoles: ReadonlySet<string>,
  action: string
): Promise<Result<{ load: ShipmentAccess; actorDriverId: number | null }>> {
  if (!allowedRoles.has(actor.role)) return err(forbidden(`This role cannot ${action}`, { role: actor.role }))

  const found = await shipments.findForActor(actor, loadId)
  if (!found.ok) return found
  // Not found and not-yours are the same answer on purpose.
  if (!found.value) return err(notFound('Shipment'))

  let actorDriverId: number | null = null
  if (actor.role === 'driver') {
    const driver = await shipments.findDriverIdForActor(actor)
    if (!driver.ok) return driver
    if (driver.value === null || found.value.driverId !== driver.value) return err(notFound('Shipment'))
    actorDriverId = driver.value
  }
  return ok({ load: found.value, actorDriverId })
}
