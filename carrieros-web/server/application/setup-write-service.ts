import { roleHasCapability } from '@/lib/generated/role-capabilities'
import type { ActorContext } from '../domain/shared/identity'
import { buildCustomerUpdate, type UpdateCustomerRawInput } from '../domain/customer/write'
import { err, forbidden, type Result } from '../domain/shared/result'
import type {
  BillingWriteRepository,
  CreateCustomerInput,
  CreateVehicleInput,
  CustomerWriteRepository,
  DriverDirectoryRepository,
  DriverSummaryRecord,
  IdempotencyRepository,
  PaymentMethodRecord,
  PlanChangeRecord,
  UpdateVehicleInput,
  VehicleWriteRepository,
} from '../ports'
import { withIdempotency } from './idempotency'

type StripeCreator = (org: { id: number; name?: string | null }) => Promise<{ stripe_customer_id: string; card_brand: string; card_last4: string }>

export class SetupWriteService {
  constructor(private readonly deps: {
    readonly billing: BillingWriteRepository
    readonly customers: CustomerWriteRepository
    readonly vehicles: VehicleWriteRepository
    readonly drivers: DriverDirectoryRepository
    readonly idempotency: IdempotencyRepository
    readonly createStripeCustomer: StripeCreator
  }) {}

  addPaymentMethod(actor: ActorContext, key: string): Promise<Result<PaymentMethodRecord>> {
    if (!roleHasCapability(actor.role, 'subscription_management')) return Promise.resolve(err(forbidden('This role cannot manage billing', { role: actor.role })))
    return withIdempotency(this.deps.idempotency, actor, 'POST /billing/add-payment-method', key, {}, async () => {
      const name = await this.deps.billing.organizationName(actor)
      if (!name.ok) return name
      const stripe = await this.deps.createStripeCustomer({ id: actor.orgId, name: name.value })
      return this.deps.billing.savePaymentMethod(actor, {
        stripeCustomerId: stripe.stripe_customer_id,
        cardBrand: stripe.card_brand,
        cardLast4: stripe.card_last4,
      })
    })
  }

  createCustomer(actor: ActorContext, input: CreateCustomerInput, key: string) {
    if (!roleHasCapability(actor.role, 'customers_manage')) return Promise.resolve(err(forbidden('This role cannot create customers', { role: actor.role })))
    return withIdempotency(this.deps.idempotency, actor, 'POST /customers', key, input, () => this.deps.customers.create(actor, input))
  }

  createVehicle(actor: ActorContext, input: CreateVehicleInput, key: string) {
    if (!roleHasCapability(actor.role, 'vehicles_manage')) return Promise.resolve(err(forbidden('This role cannot create vehicles', { role: actor.role })))
    return withIdempotency(this.deps.idempotency, actor, 'POST /vehicles', key, input, () => this.deps.vehicles.create(actor, input))
  }

  listDrivers(actor: ActorContext): Promise<Result<readonly DriverSummaryRecord[]>> {
    if (!roleHasCapability(actor.role, 'drivers')) return Promise.resolve(err(forbidden('This role cannot view drivers', { role: actor.role })))
    return this.deps.drivers.listActive(actor)
  }

  updateCustomer(actor: ActorContext, customerOrgId: number, raw: UpdateCustomerRawInput) {
    if (!roleHasCapability(actor.role, 'customers_manage')) return Promise.resolve(err(forbidden('This role cannot edit customers', { role: actor.role })))
    const patch = buildCustomerUpdate(raw)
    if (!patch.ok) return Promise.resolve(patch)
    return this.deps.customers.update(actor, customerOrgId, patch.value)
  }

  updateVehicle(actor: ActorContext, vehicleId: number, input: UpdateVehicleInput) {
    if (!roleHasCapability(actor.role, 'vehicles_manage')) return Promise.resolve(err(forbidden('This role cannot edit vehicles', { role: actor.role })))
    return this.deps.vehicles.update(actor, vehicleId, input)
  }

  changeTier(actor: ActorContext, tier: string, paymentReference: string): Promise<Result<PlanChangeRecord>> {
    if (!roleHasCapability(actor.role, 'subscription_management')) return Promise.resolve(err(forbidden('This role cannot manage billing', { role: actor.role })))
    return this.deps.billing.changeTier(actor, tier, paymentReference)
  }
}
