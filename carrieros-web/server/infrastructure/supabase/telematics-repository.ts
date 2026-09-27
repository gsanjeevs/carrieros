// server/infrastructure/supabase/telematics-repository.ts
// RLS-scoped adapter for telematics_integrations (migration 0042). Same
// posture as SupabaseWebhookRepository's Settings-surface half: the caller's
// own Supabase client is the right adapter (owner_solo_telematics_integrations_all
// grants owner/solo direct tenant-scoped access), no service-role indirection
// needed for this CRUD surface. The service-role-only writers used by the
// Motive webhook receiver and Samsara poller live in their own route files,
// not here, since neither has a caller session to scope by in the first
// place (mirrors webhook_deliveries' write-path split).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import { isTelematicsProvider, type TelematicsIntegrationSummary, type TelematicsProvider } from '../../domain/telematics/model'
import type { TelematicsIntegrationRepository } from '../../ports'

const SUMMARY_COLUMNS = 'provider, enabled, api_key_encrypted, webhook_secret_encrypted, updated_at, updated_by'

type SummaryRow = {
  provider: string
  enabled: boolean
  api_key_encrypted: string | null
  webhook_secret_encrypted: string | null
  updated_at: string
  updated_by: string | null
}

function toSummary(row: SummaryRow): TelematicsIntegrationSummary | null {
  if (!isTelematicsProvider(row.provider)) return null
  return {
    provider: row.provider,
    enabled: row.enabled,
    credentialConfigured: row.api_key_encrypted != null || row.webhook_secret_encrypted != null,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export class SupabaseTelematicsIntegrationRepository implements TelematicsIntegrationRepository {
  constructor(private readonly session: SupabaseClient<Database>) {}

  async listForOrg(actor: ActorContext): Promise<Result<readonly TelematicsIntegrationSummary[]>> {
    const { data, error } = await this.session
      .from('telematics_integrations')
      .select(SUMMARY_COLUMNS)
      .eq('carrier_org_id', actor.orgId)
    if (error) return err(domainError('PRECONDITION_FAILED', `telematics integration list failed: ${error.message}`))
    return ok((data ?? []).map(toSummary).filter((s): s is TelematicsIntegrationSummary => s !== null))
  }

  async upsert(
    actor: ActorContext,
    provider: TelematicsProvider,
    patch: { apiKeyEncrypted?: string | null; webhookSecretEncrypted?: string | null; enabled?: boolean }
  ): Promise<Result<TelematicsIntegrationSummary>> {
    // Read the existing row first (if any) -- an upsert that only ever touches the fields actually
    // provided must not clobber the other credential column back to NULL when only `enabled` is
    // being toggled, since the table's CHECK constraint requires exactly one of the two credential
    // columns to be non-null for a given provider.
    const { data: existing, error: readError } = await this.session
      .from('telematics_integrations')
      .select(SUMMARY_COLUMNS)
      .eq('carrier_org_id', actor.orgId)
      .eq('provider', provider)
      .maybeSingle()
    if (readError) return err(domainError('PRECONDITION_FAILED', `telematics integration read failed: ${readError.message}`))

    const row: Database['public']['Tables']['telematics_integrations']['Insert'] = {
      carrier_org_id: actor.orgId,
      provider,
      enabled: patch.enabled ?? existing?.enabled ?? true,
      api_key_encrypted:
        provider === 'samsara'
          ? (patch.apiKeyEncrypted !== undefined ? patch.apiKeyEncrypted : existing?.api_key_encrypted ?? null)
          : null,
      webhook_secret_encrypted:
        provider === 'motive'
          ? (patch.webhookSecretEncrypted !== undefined ? patch.webhookSecretEncrypted : existing?.webhook_secret_encrypted ?? null)
          : null,
      updated_by: actor.userId,
    }

    const { data, error } = await this.session
      .from('telematics_integrations')
      .upsert(row, { onConflict: 'carrier_org_id,provider' })
      .select(SUMMARY_COLUMNS)
      .single()
    if (error || !data) return err(domainError('PRECONDITION_FAILED', `telematics integration upsert failed: ${error?.message ?? 'no row returned'}`))
    const summary = toSummary(data)
    if (!summary) return err(domainError('PRECONDITION_FAILED', 'telematics integration upsert returned an unrecognized provider'))
    return ok(summary)
  }
}
