import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { generateVehicleNumber } from '@/lib/generate-number'
import { domainError, err, ok, validationFailed, type Result } from '../../domain/shared/result'
import type { ActorContext, UserId } from '../../domain/shared/identity'
import type {
  BillingWriteRepository,
  CreateCustomerInput,
  CreateVehicleInput,
  CustomerWriteRepository,
  DriverDirectoryRepository,
  DriverSummaryRecord,
  OnboardingRepository,
  PaymentMethodRecord,
  UpdateCustomerInput,
  UpdateVehicleInput,
  VehicleWriteRepository,
} from '../../ports'
import type { OnboardingDraft } from '../../domain/onboarding/draft'

const fail = (what: string, message: string) => err(domainError('PRECONDITION_FAILED', `${what} failed: ${message}`))
const LOAD_EMAIL_DOMAIN = process.env.LOAD_EMAIL_DOMAIN ?? 'carrierosapp.com'

async function generateLoadEmail(admin: SupabaseClient<Database>, companyName: string): Promise<string | null> {
  const base = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'carrier'
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `loads@${attempt === 0 ? base : `${base}-${attempt + 1}`}.${LOAD_EMAIL_DOMAIN}`
    const { data, error } = await admin.from('carrier_details').select('org_id').eq('load_email', candidate).maybeSingle()
    if (error) return null
    if (!data) return candidate
  }
  return null
}

export class SupabaseOnboardingRepository implements OnboardingRepository {
  constructor(private readonly session: SupabaseClient<Database>, private readonly admin: SupabaseClient<Database>) {}

  async hasOrganization(userId: UserId): Promise<Result<boolean>> {
    const { data, error } = await this.session.from('profiles').select('org_id').eq('id', userId).maybeSingle()
    if (error) return fail('profile lookup', error.message)
    return ok(data?.org_id != null)
  }

  async create(userId: UserId, draft: OnboardingDraft): Promise<Result<{ orgId: number; loadEmail: string | null }>> {
    const loadEmail = await generateLoadEmail(this.admin, draft.companyName)
    const { data: org, error: orgError } = await this.admin.from('organizations').insert({
      type: 'carrier', name: draft.companyName, ein: draft.ein, address: draft.address, city: draft.city,
      state: draft.state, zip: draft.zip, country: draft.country, currency: draft.currency,
    }).select('id').single()
    if (orgError || !org) return fail('organization create', orgError?.message ?? 'No row returned')
    const orgId = Number(org.id)
    const { error: detailsError } = await this.admin.from('carrier_details').insert({
      org_id: orgId, mc_number: draft.mcNumber, dot_number: draft.dotNumber, tier: draft.tier,
      timezone: draft.timezone, uom_system: draft.uomSystem, default_net_terms_days: draft.netTermsDays, load_email: loadEmail,
    })
    if (detailsError) return fail('carrier details create', detailsError.message)
    const { error: profileError } = await this.admin.from('profiles').upsert({
      id: userId, org_id: orgId, role: draft.role, first_name: draft.firstName, last_name: draft.lastName,
    })
    if (profileError) return fail('profile create', profileError.message)
    return ok({ orgId, loadEmail })
  }
}

export class SupabaseSetupRepository implements BillingWriteRepository, CustomerWriteRepository, VehicleWriteRepository, DriverDirectoryRepository {
  constructor(private readonly session: SupabaseClient<Database>, private readonly admin: SupabaseClient<Database>) {}

  async organizationName(actor: ActorContext): Promise<Result<string | null>> {
    const { data, error } = await this.session.from('organizations').select('name').eq('id', actor.orgId).maybeSingle()
    if (error) return fail('organization lookup', error.message)
    return ok(data?.name ?? null)
  }

  async savePaymentMethod(actor: ActorContext, value: { stripeCustomerId: string; cardBrand: string; cardLast4: string }): Promise<Result<PaymentMethodRecord>> {
    const { data, error } = await this.admin.from('carrier_details').update({
      stripe_customer_id: value.stripeCustomerId, card_brand: value.cardBrand, card_last4: value.cardLast4,
    }).eq('org_id', actor.orgId).select('stripe_customer_id, card_brand, card_last4, billing_status, trial_ends_at').single()
    if (error || !data) return fail('payment method update', error?.message ?? 'No row returned')
    return ok(data)
  }

  // Mirrors app/api/billing/change-tier/route.ts: validates against the real
  // `tiers` table (not a hardcoded list) via the request-scoped client (read
  // access is fine under RLS), then writes carrier_details.tier with the
  // admin client the same way the legacy route does (carrier_details is
  // server-write-only, migration 0019).
  async changeTier(actor: ActorContext, tier: string): Promise<Result<string>> {
    const { data: tierRow, error: tierError } = await this.session.from('tiers').select('code').eq('code', tier).maybeSingle()
    if (tierError) return fail('tier lookup', tierError.message)
    if (!tierRow) return err(validationFailed('Unknown tier', { tier: 'INVALID' }))

    const { data, error } = await this.admin.from('carrier_details').update({ tier }).eq('org_id', actor.orgId).select('tier').single()
    if (error || !data) return fail('tier change', error?.message ?? 'No row returned')
    // `tier` (the just-validated, just-written input) rather than `data.tier`:
    // the column is nullable in the generated type even though this update
    // just set it to a real value, so `data.tier` is `string | null` here.
    return ok(tier)
  }

  async create(actor: ActorContext, input: CreateCustomerInput): Promise<Result<{ org_id: number; name: string; customer_number: string | null }>>
  async create(actor: ActorContext, input: CreateVehicleInput): Promise<Result<{ vehicle_number: string | null; nickname: string }>>
  async create(
    actor: ActorContext,
    input: CreateCustomerInput | CreateVehicleInput,
  ): Promise<Result<{ org_id: number; name: string; customer_number: string | null } | { vehicle_number: string | null; nickname: string }>> {
    if ('name' in input) return this.createCustomer(input)
    return this.createVehicle(actor, input)
  }

  private async createCustomer(input: CreateCustomerInput) {
    const { data, error } = await this.session.rpc('create_customer_org', {
      p_name: input.name, p_phone: input.phone ?? undefined, p_email: input.email ?? undefined, p_address: input.address ?? undefined,
      p_city: input.city ?? undefined, p_state: input.state ?? undefined, p_zip: input.zip ?? undefined, p_country: input.country ?? 'US',
      p_contact_name: input.contactName ?? undefined, p_notes: input.notes ?? undefined,
    })
    if (error) {
      if (error.message.includes('FORBIDDEN')) return err(domainError('FORBIDDEN', error.message))
      if (error.message.includes('VALIDATION_ERROR')) return err(validationFailed(error.message))
      return fail('customer create', error.message)
    }
    const row = Array.isArray(data) ? data[0] : data
    if (!row) return fail('customer create', 'No row returned')
    return ok({ org_id: Number(row.org_id), name: row.name, customer_number: row.customer_number })
  }

  // Neither edit capability was ever built before (legacy or v1). Overloaded
  // the same way `create` above is, since this one class implements both
  // CustomerWriteRepository.update and VehicleWriteRepository.update.
  async update(actor: ActorContext, id: number, input: UpdateCustomerInput): Promise<Result<{ org_id: number; name: string; customer_number: string | null }>>
  async update(actor: ActorContext, id: number, input: UpdateVehicleInput): Promise<Result<{ vehicle_number: string | null; nickname: string } | null>>
  async update(
    actor: ActorContext,
    id: number,
    input: UpdateCustomerInput | UpdateVehicleInput,
  ): Promise<Result<{ org_id: number; name: string; customer_number: string | null } | { vehicle_number: string | null; nickname: string } | null>> {
    if ('contactNameProvided' in input) return this.updateCustomer(actor, id, input)
    return this.updateVehicle(actor, id, input)
  }

  // A carrier has no direct RLS write access to a customer org's own
  // `organizations` row, so this goes through update_customer_org()
  // (migration 0034), same SECURITY DEFINER shape as create_customer_org.
  private async updateCustomer(actor: ActorContext, customerOrgId: number, input: UpdateCustomerInput) {
    const { data, error } = await this.session.rpc('update_customer_org', {
      p_customer_org_id: customerOrgId,
      p_name: input.name ?? undefined, p_phone: input.phone ?? undefined, p_email: input.email ?? undefined,
      p_address: input.address ?? undefined, p_city: input.city ?? undefined, p_state: input.state ?? undefined,
      p_zip: input.zip ?? undefined, p_country: input.country ?? undefined,
      p_contact_name: input.contactName ?? undefined, p_notes: input.notes ?? undefined,
      p_set_contact_name: input.contactNameProvided, p_set_notes: input.notesProvided,
    })
    if (error) {
      if (error.message.includes('NOT_FOUND')) return err(domainError('NOT_FOUND', 'Customer not found'))
      if (error.message.includes('FORBIDDEN')) return err(domainError('FORBIDDEN', error.message))
      if (error.message.includes('VALIDATION_ERROR')) return err(validationFailed(error.message))
      return fail('customer update', error.message)
    }
    const row = Array.isArray(data) ? data[0] : data
    if (!row) return fail('customer update', 'No row returned')
    return ok({ org_id: Number(row.org_id), name: row.name, customer_number: row.customer_number })
  }

  // `vehicles` RLS (owner_solo_vehicles_all) already grants owner/solo a
  // direct tenant-scoped UPDATE, so no RPC is needed here, unlike customers
  // (which cross a tenant boundary).
  private async updateVehicle(actor: ActorContext, vehicleId: number, input: UpdateVehicleInput) {
    const patch: Database['public']['Tables']['vehicles']['Update'] = {}
    for (const [key, dbKey] of [
      ['nickname', 'nickname'], ['year', 'year'], ['make', 'make'], ['model', 'model'], ['vin', 'vin'],
      ['licensePlate', 'license_plate'], ['licenseState', 'license_state'], ['cabType', 'cab_type'],
      ['color', 'color'], ['dimensions', 'dimensions'],
      // Spelled snake_case here (unlike the camelCase-vs-snake_case pairs above) because
      // CreateVehicleInput/UpdateVehicleInput (server/ports/index.ts) deliberately name these two
      // fields to match the real runtime shape passed through from the route — see that file's
      // comment.
      ['telematics_provider', 'telematics_provider'], ['telematics_device_id', 'telematics_device_id'],
    ] as const) {
      if (key in input) patch[dbKey] = input[key] as never
    }
    const { data, error } = await this.session.from('vehicles').update(patch)
      .eq('id', vehicleId).eq('carrier_org_id', actor.orgId)
      .select('vehicle_number, nickname').maybeSingle()
    if (error) return fail('vehicle update', error.message)
    return ok(data ? { vehicle_number: data.vehicle_number, nickname: data.nickname } : null)
  }

  private async createVehicle(actor: ActorContext, input: CreateVehicleInput) {
    let vehicleNumber: string
    try { vehicleNumber = await generateVehicleNumber(this.session, actor.orgId) }
    catch (error) { return fail('vehicle number generation', error instanceof Error ? error.message : String(error)) }
    const { data, error } = await this.session.from('vehicles').insert({
      carrier_org_id: actor.orgId, vehicle_number: vehicleNumber, vehicle_type_id: input.vehicleTypeId, nickname: input.nickname,
      year: input.year ?? null, make: input.make ?? null, model: input.model ?? null, vin: input.vin ?? null,
      license_plate: input.licensePlate ?? null, license_state: input.licenseState ?? null, cab_type: input.cabType ?? null,
      color: input.color ?? null, dimensions: input.dimensions ?? null,
    }).select('vehicle_number, nickname').single()
    if (error || !data) return fail('vehicle create', error?.message ?? 'No row returned')
    return ok({ vehicle_number: data.vehicle_number, nickname: data.nickname })
  }

  async listActive(actor: ActorContext): Promise<Result<readonly DriverSummaryRecord[]>> {
    const { data, error } = await (this.session as unknown as SupabaseClient).from('drivers')
      .select('id, driver_number, invite_status, default_vehicle_id, cdl_expiry, med_cert_expiry, is_active, profiles(first_name, last_name, phone)')
      .eq('carrier_org_id', actor.orgId).eq('is_active', true).order('driver_number', { ascending: true })
    if (error) return fail('driver list', error.message)
    const rows = (data ?? []) as unknown as Array<Omit<DriverSummaryRecord, 'first_name' | 'last_name' | 'phone'> & { profiles: { first_name: string | null; last_name: string | null; phone: string | null } | null }>
    return ok(rows.map(({ profiles, ...row }) => ({ ...row, id: Number(row.id), first_name: profiles?.first_name ?? null, last_name: profiles?.last_name ?? null, phone: profiles?.phone ?? null })))
  }
}
