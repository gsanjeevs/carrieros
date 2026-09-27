// server/infrastructure/supabase/loadboard-repository.ts
// RLS-scoped adapters for loadboard_integrations and loadboard_postings
// (migration 0052). Same posture as telematics-repository.ts: the caller's
// own Supabase client is the right adapter -- carrier_loadboard_integrations_all
// / carrier_loadboard_postings_select / carrier_loadboard_postings_insert
// grant owner/solo/dispatcher direct tenant-scoped access, no service-role
// indirection needed for this Phase-1 CRUD + audit-trail surface.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, validationFailed, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import {
  isLoadboardProvider,
  type LoadboardIntegrationSummary,
  type LoadboardPostingSummary,
  type LoadboardProvider,
  type LoadPostingResult,
} from '../../domain/loadboard/model'
import type { LoadboardIntegrationRepository, LoadboardPostingLoadFields, LoadboardPostingRepository } from '../../ports'

const SUMMARY_COLUMNS = 'provider, enabled, api_key_encrypted, updated_at, updated_by'

type SummaryRow = {
  provider: string
  enabled: boolean
  api_key_encrypted: string | null
  updated_at: string
  updated_by: string | null
}

function toSummary(row: SummaryRow): LoadboardIntegrationSummary | null {
  if (!isLoadboardProvider(row.provider)) return null
  return {
    provider: row.provider,
    enabled: row.enabled,
    credentialConfigured: row.api_key_encrypted != null,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export class SupabaseLoadboardIntegrationRepository implements LoadboardIntegrationRepository {
  constructor(private readonly session: SupabaseClient<Database>) {}

  async listForOrg(actor: ActorContext): Promise<Result<readonly LoadboardIntegrationSummary[]>> {
    const { data, error } = await this.session
      .from('loadboard_integrations')
      .select(SUMMARY_COLUMNS)
      .eq('carrier_org_id', actor.orgId)
    if (error) return err(domainError('PRECONDITION_FAILED', `loadboard integration list failed: ${error.message}`))
    return ok((data ?? []).map(toSummary).filter((s): s is LoadboardIntegrationSummary => s !== null))
  }

  async upsert(
    actor: ActorContext,
    provider: LoadboardProvider,
    patch: { apiKeyEncrypted?: string | null; enabled?: boolean }
  ): Promise<Result<LoadboardIntegrationSummary>> {
    // Read the existing row first (if any) -- an upsert that only touches the fields actually
    // provided must not clobber api_key_encrypted back to NULL when only `enabled` is being toggled.
    const { data: existing, error: readError } = await this.session
      .from('loadboard_integrations')
      .select(SUMMARY_COLUMNS)
      .eq('carrier_org_id', actor.orgId)
      .eq('provider', provider)
      .maybeSingle()
    if (readError) return err(domainError('PRECONDITION_FAILED', `loadboard integration read failed: ${readError.message}`))

    const row: Database['public']['Tables']['loadboard_integrations']['Insert'] = {
      carrier_org_id: actor.orgId,
      provider,
      enabled: patch.enabled ?? existing?.enabled ?? true,
      api_key_encrypted: patch.apiKeyEncrypted !== undefined ? patch.apiKeyEncrypted : existing?.api_key_encrypted ?? null,
      updated_by: actor.userId,
    }

    const { data, error } = await this.session
      .from('loadboard_integrations')
      .upsert(row, { onConflict: 'carrier_org_id,provider' })
      .select(SUMMARY_COLUMNS)
      .single()
    if (error || !data) return err(domainError('PRECONDITION_FAILED', `loadboard integration upsert failed: ${error?.message ?? 'no row returned'}`))
    const summary = toSummary(data)
    if (!summary) return err(domainError('PRECONDITION_FAILED', 'loadboard integration upsert returned an unrecognized provider'))
    return ok(summary)
  }

  async getCredential(
    actor: ActorContext,
    provider: LoadboardProvider
  ): Promise<Result<{ apiKeyEncrypted: string | null; enabled: boolean } | null>> {
    const { data, error } = await this.session
      .from('loadboard_integrations')
      .select('api_key_encrypted, enabled')
      .eq('carrier_org_id', actor.orgId)
      .eq('provider', provider)
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `loadboard integration credential read failed: ${error.message}`))
    if (!data) return ok(null)
    return ok({ apiKeyEncrypted: data.api_key_encrypted, enabled: data.enabled })
  }
}

function toPostingSummary(row: {
  load_id: number
  provider: string
  external_posting_id: string
  posted_at: string
  posted_by: string | null
}): LoadboardPostingSummary | null {
  if (!isLoadboardProvider(row.provider)) return null
  return {
    loadId: row.load_id,
    provider: row.provider,
    externalPostingId: row.external_posting_id,
    postedAt: row.posted_at,
    postedBy: row.posted_by,
  }
}

export class SupabaseLoadboardPostingRepository implements LoadboardPostingRepository {
  constructor(private readonly session: SupabaseClient<Database>) {}

  async getForLoad(actor: ActorContext, loadId: number, provider: LoadboardProvider): Promise<Result<LoadboardPostingSummary | null>> {
    const { data, error } = await this.session
      .from('loadboard_postings')
      .select('load_id, provider, external_posting_id, posted_at, posted_by')
      .eq('carrier_org_id', actor.orgId)
      .eq('load_id', loadId)
      .eq('provider', provider)
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `loadboard posting read failed: ${error.message}`))
    if (!data) return ok(null)
    const summary = toPostingSummary(data)
    if (!summary) return err(domainError('PRECONDITION_FAILED', 'loadboard posting row has an unrecognized provider'))
    return ok(summary)
  }

  async create(
    actor: ActorContext,
    loadId: number,
    provider: LoadboardProvider,
    result: LoadPostingResult
  ): Promise<Result<LoadboardPostingSummary>> {
    const row: Database['public']['Tables']['loadboard_postings']['Insert'] = {
      carrier_org_id: actor.orgId,
      load_id: loadId,
      provider,
      external_posting_id: result.externalPostingId,
      posted_at: result.postedAt,
      posted_by: actor.userId,
    }
    const { data, error } = await this.session
      .from('loadboard_postings')
      .insert(row)
      .select('load_id, provider, external_posting_id, posted_at, posted_by')
      .single()
    if (error || !data) {
      // 23505 = unique violation on (load_id, provider) -- someone else posted this load in the gap
      // between the caller's "already posted" check and this insert.
      if (error?.code === '23505') return err(validationFailed('This load has already been posted to this provider', { provider: 'ALREADY_POSTED' }))
      return err(domainError('PRECONDITION_FAILED', `loadboard posting insert failed: ${error?.message ?? 'no row returned'}`))
    }
    const summary = toPostingSummary(data)
    if (!summary) return err(domainError('PRECONDITION_FAILED', 'loadboard posting insert returned an unrecognized provider'))
    return ok(summary)
  }

  async getLoadForPosting(actor: ActorContext, loadId: number): Promise<Result<LoadboardPostingLoadFields | null>> {
    const { data, error } = await this.session
      .from('loads')
      .select('id, pickup_city, pickup_state, delivery_city, delivery_state, pickup_date, weight_lbs, rate')
      .eq('id', loadId)
      .eq('carrier_org_id', actor.orgId)
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `load lookup failed: ${error.message}`))
    if (!data) return ok(null)
    return ok({
      id: data.id,
      pickupCity: data.pickup_city,
      pickupState: data.pickup_state,
      deliveryCity: data.delivery_city,
      deliveryState: data.delivery_state,
      pickupDate: data.pickup_date,
      weightLbs: data.weight_lbs,
      rate: data.rate,
    })
  }
}
