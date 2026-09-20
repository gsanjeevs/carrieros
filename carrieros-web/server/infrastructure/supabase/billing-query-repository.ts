// server/infrastructure/supabase/billing-query-repository.ts
// Read side for billing, through the CALLER'S client (RLS applies).
// carrier_details_select and tiers_select have no role restriction in RLS —
// the owner/solo-only boundary is an application-layer decision (see
// BillingQueryService), matching carrieros-web/app/(app)/billing/page.tsx.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { BillingDetailsRecord, BillingQueryRepository, TierPricingRecord } from '../../ports'

export class SupabaseBillingQueryRepository implements BillingQueryRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async getForOrg(actor: ActorContext): Promise<Result<BillingDetailsRecord | null>> {
    const { data, error } = await this.supabase
      .from('carrier_details')
      .select('tier, billing_status, trial_ends_at, stripe_customer_id, card_brand, card_last4')
      .eq('org_id', actor.orgId)
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `billing lookup failed: ${error.message}`))
    return ok(data as unknown as BillingDetailsRecord | null)
  }

  async activeVehicleCount(actor: ActorContext): Promise<Result<number>> {
    const { count, error } = await this.supabase
      .from('vehicles')
      .select('*', { count: 'exact', head: true })
      .eq('carrier_org_id', actor.orgId)
      .eq('is_active', true)
    if (error) return err(domainError('PRECONDITION_FAILED', `vehicle count failed: ${error.message}`))
    return ok(count ?? 0)
  }

  async tierPricing(code: string): Promise<Result<TierPricingRecord | null>> {
    const { data, error } = await this.supabase
      .from('tiers')
      .select('included_trucks, price_per_additional_truck')
      .eq('code', code)
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `tier lookup failed: ${error.message}`))
    if (!data) return ok(null)
    return ok({ included_trucks: Number(data.included_trucks), price_per_additional_truck: Number(data.price_per_additional_truck) })
  }
}
