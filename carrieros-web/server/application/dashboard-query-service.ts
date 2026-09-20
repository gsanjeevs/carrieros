// server/application/dashboard-query-service.ts
// One assembled read per caller's role for the mobile Home tab, replacing
// mobile/(tabs)/home.tsx's five-to-eight separate direct-table round trips
// with a single authorized call. Each role's content branch mirrors that
// screen's own loadOwnerSoloContent/loadSoloDriverCard/loadDispatcherContent/
// loadFinanceContent exactly — this is an assembly of already-established
// per-table scoping (loads, vehicles, drivers, invoices), not a new
// authorization decision, so there is no separate capability gate beyond
// "is this one of the four roles the screen supports".
import { err, forbidden, ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { DashboardInvoiceRecord, DashboardLoadRecord, DashboardOpsLoad, DashboardQueryRepository } from '../ports'

const RECENT_LOADS_LIMIT = 5
const INVOICE_LIST_LIMIT = 5

export interface DashboardOutput {
  readonly role: string
  readonly active_loads_count?: number
  readonly fleet_counts?: { active: number; idle: number; in_shop: number }
  readonly recent_loads?: readonly DashboardLoadRecord[]
  readonly solo_active_load?: DashboardLoadRecord | null
  readonly ops_loads?: readonly DashboardOpsLoad[]
  readonly available_drivers?: number
  readonly available_vehicles?: number
  readonly outstanding_total?: number
  readonly outstanding_count?: number
  readonly most_overdue_invoices?: readonly DashboardInvoiceRecord[]
  readonly recent_payments?: readonly DashboardInvoiceRecord[]
}

export class DashboardQueryService {
  constructor(private readonly deps: { readonly dashboard: DashboardQueryRepository }) {}

  async get(actor: ActorContext): Promise<Result<DashboardOutput>> {
    if (actor.role === 'owner' || actor.role === 'solo') return this.ownerSolo(actor)
    if (actor.role === 'dispatcher') return this.dispatcher(actor)
    if (actor.role === 'finance') return this.finance(actor)
    return err(forbidden('This role has no dashboard content', { role: actor.role }))
  }

  private async ownerSolo(actor: ActorContext): Promise<Result<DashboardOutput>> {
    const [count, fleet, recent, own] = await Promise.all([
      this.deps.dashboard.activeLoadsCount(actor),
      this.deps.dashboard.fleetStatusCounts(actor),
      this.deps.dashboard.recentLoads(actor, RECENT_LOADS_LIMIT),
      actor.role === 'solo' ? this.deps.dashboard.ownActiveLoad(actor) : Promise.resolve(ok(null)),
    ])
    if (!count.ok) return count
    if (!fleet.ok) return fleet
    if (!recent.ok) return recent
    if (!own.ok) return own

    return ok({
      role: actor.role,
      active_loads_count: count.value,
      fleet_counts: fleet.value,
      recent_loads: recent.value,
      ...(actor.role === 'solo' ? { solo_active_load: own.value } : {}),
    })
  }

  private async dispatcher(actor: ActorContext): Promise<Result<DashboardOutput>> {
    const opsLoads = await this.deps.dashboard.opsLoads(actor)
    if (!opsLoads.ok) return opsLoads

    const assignedDriverIds = [...new Set(opsLoads.value.map((l) => l.driver_id).filter((id): id is number => id != null))]
    const assignedVehicleIds = [...new Set(opsLoads.value.map((l) => l.vehicle_id).filter((id): id is number => id != null))]

    const [drivers, vehicles] = await Promise.all([
      this.deps.dashboard.availableDriversCount(actor, assignedDriverIds),
      this.deps.dashboard.availableVehiclesCount(actor, assignedVehicleIds),
    ])
    if (!drivers.ok) return drivers
    if (!vehicles.ok) return vehicles

    return ok({ role: actor.role, ops_loads: opsLoads.value, available_drivers: drivers.value, available_vehicles: vehicles.value })
  }

  private async finance(actor: ActorContext): Promise<Result<DashboardOutput>> {
    const [outstanding, overdue, payments] = await Promise.all([
      this.deps.dashboard.outstandingInvoices(actor),
      this.deps.dashboard.overdueInvoices(actor, INVOICE_LIST_LIMIT),
      this.deps.dashboard.recentPayments(actor, INVOICE_LIST_LIMIT),
    ])
    if (!outstanding.ok) return outstanding
    if (!overdue.ok) return overdue
    if (!payments.ok) return payments

    return ok({
      role: actor.role,
      outstanding_count: outstanding.value.length,
      outstanding_total: outstanding.value.reduce((sum, r) => sum + r.amount, 0),
      most_overdue_invoices: overdue.value,
      recent_payments: payments.value,
    })
  }
}
