// server/application/billing-query-service.ts
// Read use case for the billing screen. carrier_details/tiers RLS has no
// role restriction, so the owner/solo-only boundary is enforced here, via the
// generated `subscription_management` capability — the same gate
// carrieros-web/app/(app)/billing/page.tsx already uses.
import { err, forbidden, notFound, ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { BillingQueryRepository } from '../ports'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

export interface BillingOutput {
  readonly tier: string | null
  readonly billing_status: string | null
  readonly trial_ends_at: string | null
  readonly stripe_customer_id: string | null
  readonly card_brand: string | null
  readonly card_last4: string | null
  readonly vehicle_count: number
  readonly included_trucks: number
  readonly price_per_additional_truck: number
}

export class BillingQueryService {
  constructor(private readonly deps: { readonly billing: BillingQueryRepository }) {}

  async get(actor: ActorContext): Promise<Result<BillingOutput>> {
    if (!roleHasCapability(actor.role, 'subscription_management')) return err(forbidden('This role cannot view billing', { role: actor.role }))

    const details = await this.deps.billing.getForOrg(actor)
    if (!details.ok) return details
    if (!details.value) return err(notFound('Billing details'))

    const vehicleCount = await this.deps.billing.activeVehicleCount(actor)
    if (!vehicleCount.ok) return vehicleCount

    let includedTrucks = 0
    let pricePerAdditional = 0
    if (details.value.tier) {
      const pricing = await this.deps.billing.tierPricing(details.value.tier)
      if (!pricing.ok) return pricing
      includedTrucks = pricing.value?.included_trucks ?? 0
      pricePerAdditional = pricing.value?.price_per_additional_truck ?? 0
    }

    return ok({
      tier: details.value.tier,
      billing_status: details.value.billing_status,
      trial_ends_at: details.value.trial_ends_at,
      stripe_customer_id: details.value.stripe_customer_id,
      card_brand: details.value.card_brand,
      card_last4: details.value.card_last4,
      vehicle_count: vehicleCount.value,
      included_trucks: includedTrucks,
      price_per_additional_truck: pricePerAdditional,
    })
  }
}
