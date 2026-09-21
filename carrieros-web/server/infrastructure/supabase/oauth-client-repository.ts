// server/infrastructure/supabase/oauth-client-repository.ts
// Adapters for the public developer API's own tables/RPCs (migration 0025).
// All three classes run as service_role: oauth_clients and
// oauth_client_rate_limits have zero authenticated/anon grants, because there
// is no Supabase session for this caller — org scoping is therefore enforced
// in every query here, not by RLS. Same posture as
// SupabaseChangeFeedRepository/SupabaseIdempotencyRepository.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { OrgId } from '../../domain/shared/identity'
import type { OAuthClientSummary } from '../../domain/oauth/model'
import type {
  OAuthClientRecord,
  OAuthClientRepository,
  PublicApiEntitlementGate,
  PublicApiRateLimiter,
} from '../../ports'

const SUMMARY_COLUMNS = 'id, client_id, name, created_at, last_used_at, revoked_at'

type SummaryRow = {
  id: number
  client_id: string
  name: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

const toSummary = (row: SummaryRow): OAuthClientSummary => ({
  id: row.id,
  clientId: row.client_id,
  name: row.name,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at,
})

export class SupabaseOAuthClientRepository implements OAuthClientRepository {
  constructor(private readonly admin: SupabaseClient<Database>) {}

  async listForOrg(orgId: OrgId): Promise<Result<readonly OAuthClientSummary[]>> {
    const { data, error } = await this.admin
      .from('oauth_clients')
      .select(SUMMARY_COLUMNS)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
    if (error) return err(domainError('PRECONDITION_FAILED', `oauth client list failed: ${error.message}`))
    return ok((data ?? []).map(toSummary))
  }

  async create(orgId: OrgId, name: string, clientId: string, secretHash: string): Promise<Result<OAuthClientSummary>> {
    const { data, error } = await this.admin
      .from('oauth_clients')
      .insert({ org_id: orgId, name, client_id: clientId, client_secret_hash: secretHash })
      .select(SUMMARY_COLUMNS)
      .single()
    if (error) return err(domainError('PRECONDITION_FAILED', `oauth client create failed: ${error.message}`))
    return ok(toSummary(data))
  }

  async revoke(orgId: OrgId, clientId: string): Promise<Result<boolean>> {
    const { data, error } = await this.admin
      .from('oauth_clients')
      .update({ revoked_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('client_id', clientId)
      .is('revoked_at', null)
      .select('id')
    if (error) return err(domainError('PRECONDITION_FAILED', `oauth client revoke failed: ${error.message}`))
    return ok((data ?? []).length > 0)
  }

  async findActiveByClientId(clientId: string): Promise<Result<OAuthClientRecord | null>> {
    const { data, error } = await this.admin
      .from('oauth_clients')
      .select('id, org_id, client_id, client_secret_hash, revoked_at')
      .eq('client_id', clientId)
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `oauth client lookup failed: ${error.message}`))
    if (!data) return ok(null)
    return ok({
      id: data.id,
      orgId: data.org_id as OrgId,
      clientId: data.client_id,
      clientSecretHash: data.client_secret_hash,
      revokedAt: data.revoked_at,
    })
  }

  async markUsed(clientId: string): Promise<Result<void>> {
    const { error } = await this.admin
      .from('oauth_clients')
      .update({ last_used_at: new Date().toISOString() })
      .eq('client_id', clientId)
    if (error) return err(domainError('PRECONDITION_FAILED', `oauth client mark-used failed: ${error.message}`))
    return ok(undefined)
  }
}

export class SupabasePublicApiEntitlementGate implements PublicApiEntitlementGate {
  constructor(private readonly admin: SupabaseClient<Database>) {}

  async checkPublicApiAccess(orgId: OrgId): Promise<Result<{ allowed: boolean; reason: string }>> {
    const { data, error } = await this.admin.rpc('entitlement_decision', { p_org_id: orgId, p_key: 'public_api' })
    if (error) return err(domainError('PRECONDITION_FAILED', `entitlement check failed: ${error.message}`))
    const row = data?.[0]
    return ok({ allowed: row?.allowed === true, reason: row?.reason ?? 'UNKNOWN_CAPABILITY' })
  }
}

const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_PER_WINDOW = 100

export class SupabasePublicApiRateLimiter implements PublicApiRateLimiter {
  constructor(private readonly admin: SupabaseClient<Database>) {}

  async checkAndIncrement(clientId: string): Promise<Result<{ allowed: boolean; retryAfterSeconds: number }>> {
    const { data, error } = await this.admin.rpc('check_public_api_rate_limit', {
      p_client_id: clientId,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
      p_limit: RATE_LIMIT_PER_WINDOW,
    })
    if (error) return err(domainError('PRECONDITION_FAILED', `rate limit check failed: ${error.message}`))
    const row = data?.[0]
    return ok({ allowed: row?.allowed === true, retryAfterSeconds: row?.retry_after_seconds ?? 0 })
  }
}
