// server/application/customer-query-service.ts
// Read use cases for customers. Same role rule as customer_details' RLS
// (carrier_customer_select): owner/solo/dispatcher/finance only, stated here
// via the generated `customers_view` capability so it cannot drift from RLS.
import { err, forbidden, notFound, ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { CustomerDetailRecord, CustomerLoadRecord, CustomerQueryRepository, CustomerSummaryRecord } from '../ports'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

const RECENT_LOADS_LIMIT = 10

export interface CustomerDetailOutput {
  readonly customer: CustomerDetailRecord
  readonly recent_loads: readonly CustomerLoadRecord[]
  readonly health_score: number | null
}

export class CustomerQueryService {
  constructor(private readonly deps: { readonly customers: CustomerQueryRepository }) {}

  async list(actor: ActorContext): Promise<Result<readonly CustomerSummaryRecord[]>> {
    if (!roleHasCapability(actor.role, 'customers_view')) return err(forbidden('This role cannot view customers', { role: actor.role }))
    return this.deps.customers.listForOrg(actor)
  }

  async getDetail(actor: ActorContext, customerOrgId: number): Promise<Result<CustomerDetailOutput>> {
    if (!roleHasCapability(actor.role, 'customers_view')) return err(forbidden('This role cannot view customers', { role: actor.role }))
    const found = await this.deps.customers.getForActor(actor, customerOrgId)
    if (!found.ok) return found
    if (!found.value) return err(notFound('Customer'))

    const [loads, score] = await Promise.all([
      this.deps.customers.recentLoadsForCustomer(actor, customerOrgId, RECENT_LOADS_LIMIT),
      this.deps.customers.healthScore(actor, customerOrgId),
    ])
    if (!loads.ok) return loads
    if (!score.ok) return score

    return ok({ customer: found.value, recent_loads: loads.value, health_score: score.value })
  }
}
