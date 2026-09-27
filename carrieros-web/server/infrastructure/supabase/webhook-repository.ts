// server/infrastructure/supabase/webhook-repository.ts
// Two adapters for migration 0037's tables:
//
//   SupabaseWebhookRepository  — the RLS-scoped caller's own Supabase client,
//     for every Settings-surface CRUD call (list/create/update/delete/rotate/
//     list-deliveries). Same posture as vehicles/customers: org scoping is
//     RLS's job, not this code's.
//
//   findEnabledForDispatch/SupabaseWebhookDeliveryWriter run as service_role
//   instead — WebhookDispatchService fires from inside another request's
//   success path with no session of its own to scope by, so org scoping is
//   enforced explicitly in the query, same posture as
//   SupabaseOAuthClientRepository.findActiveByClientId.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext, OrgId } from '../../domain/shared/identity'
import type { WebhookDeliveryRecord, WebhookSummary } from '../../domain/webhooks/model'
import type { WebhookDeliveryWriter, WebhookRecord, WebhookRepository } from '../../ports'

const SUMMARY_COLUMNS = 'id, url, secret, subscribed_events, enabled, created_at'

type SummaryRow = {
  id: number
  url: string
  secret: string
  subscribed_events: string[]
  enabled: boolean
  created_at: string
}

function secretPreview(secret: string): string {
  return secret.slice(-4)
}

const toSummary = (row: SummaryRow): WebhookSummary => ({
  id: row.id,
  url: row.url,
  subscribedEvents: row.subscribed_events,
  enabled: row.enabled,
  createdAt: row.created_at,
  secretPreview: secretPreview(row.secret),
})

export class SupabaseWebhookRepository implements WebhookRepository {
  /** `caller` is the RLS-scoped client for list/create/update/delete/rotate/listDeliveries.
   * `admin` (service_role) is used only by findEnabledForDispatch, which has no session to scope by. */
  constructor(
    private readonly caller: SupabaseClient<Database>,
    private readonly admin: SupabaseClient<Database>
  ) {}

  async listForOrg(actor: ActorContext): Promise<Result<readonly WebhookSummary[]>> {
    const { data, error } = await this.caller
      .from('webhooks')
      .select(SUMMARY_COLUMNS)
      .eq('org_id', actor.orgId)
      .order('created_at', { ascending: false })
    if (error) return err(domainError('PRECONDITION_FAILED', `webhook list failed: ${error.message}`))
    return ok((data ?? []).map(toSummary))
  }

  async create(
    actor: ActorContext,
    input: { url: string; secret: string; subscribedEvents: readonly string[] }
  ): Promise<Result<WebhookSummary>> {
    const { data, error } = await this.caller
      .from('webhooks')
      .insert({
        org_id: actor.orgId,
        url: input.url,
        secret: input.secret,
        subscribed_events: [...input.subscribedEvents],
        created_by: actor.userId,
      })
      .select(SUMMARY_COLUMNS)
      .single()
    if (error) return err(domainError('PRECONDITION_FAILED', `webhook create failed: ${error.message}`))
    return ok(toSummary(data))
  }

  async update(
    actor: ActorContext,
    webhookId: number,
    patch: { url?: string; subscribedEvents?: readonly string[]; enabled?: boolean }
  ): Promise<Result<WebhookSummary | null>> {
    const updatePayload: Database['public']['Tables']['webhooks']['Update'] = {}
    if (patch.url !== undefined) updatePayload.url = patch.url
    if (patch.subscribedEvents !== undefined) updatePayload.subscribed_events = [...patch.subscribedEvents]
    if (patch.enabled !== undefined) updatePayload.enabled = patch.enabled

    const { data, error } = await this.caller
      .from('webhooks')
      .update(updatePayload)
      .eq('id', webhookId)
      .eq('org_id', actor.orgId)
      .select(SUMMARY_COLUMNS)
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `webhook update failed: ${error.message}`))
    return ok(data ? toSummary(data) : null)
  }

  async delete(actor: ActorContext, webhookId: number): Promise<Result<boolean>> {
    const { data, error } = await this.caller
      .from('webhooks')
      .delete()
      .eq('id', webhookId)
      .eq('org_id', actor.orgId)
      .select('id')
    if (error) return err(domainError('PRECONDITION_FAILED', `webhook delete failed: ${error.message}`))
    return ok((data ?? []).length > 0)
  }

  async rotateSecret(actor: ActorContext, webhookId: number, newSecret: string): Promise<Result<WebhookSummary | null>> {
    const { data, error } = await this.caller
      .from('webhooks')
      .update({ secret: newSecret })
      .eq('id', webhookId)
      .eq('org_id', actor.orgId)
      .select(SUMMARY_COLUMNS)
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `webhook rotate-secret failed: ${error.message}`))
    return ok(data ? toSummary(data) : null)
  }

  async listDeliveries(actor: ActorContext, webhookId: number, limit: number): Promise<Result<readonly WebhookDeliveryRecord[]>> {
    const { data, error } = await this.caller
      .from('webhook_deliveries')
      .select('id, webhook_id, event_type, status, attempt_count, last_attempted_at, last_response_status, created_at')
      .eq('webhook_id', webhookId)
      .eq('org_id', actor.orgId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return err(domainError('PRECONDITION_FAILED', `webhook deliveries list failed: ${error.message}`))
    return ok(
      (data ?? []).map((r) => ({
        id: r.id,
        webhookId: r.webhook_id,
        eventType: r.event_type,
        status: r.status as WebhookDeliveryRecord['status'],
        attemptCount: r.attempt_count,
        lastAttemptedAt: r.last_attempted_at,
        lastResponseStatus: r.last_response_status,
        createdAt: r.created_at,
      }))
    )
  }

  async findEnabledForDispatch(orgId: OrgId, eventType: string): Promise<Result<readonly WebhookRecord[]>> {
    const { data, error } = await this.admin
      .from('webhooks')
      .select('id, org_id, url, secret, subscribed_events, enabled')
      .eq('org_id', orgId)
      .eq('enabled', true)
      .contains('subscribed_events', [eventType])
    if (error) return err(domainError('PRECONDITION_FAILED', `webhook dispatch lookup failed: ${error.message}`))
    return ok(
      (data ?? []).map((r) => ({
        id: r.id,
        orgId: r.org_id as OrgId,
        url: r.url,
        secret: r.secret,
        subscribedEvents: r.subscribed_events,
        enabled: r.enabled,
      }))
    )
  }
}

export class SupabaseWebhookDeliveryWriter implements WebhookDeliveryWriter {
  constructor(private readonly admin: SupabaseClient<Database>) {}

  async recordAttempt(input: {
    webhookId: number
    orgId: OrgId
    eventType: string
    payload: Record<string, unknown>
    status: 'success' | 'failed'
    attemptCount: number
    responseStatus: number | null
  }): Promise<Result<number>> {
    const { data, error } = await this.admin
      .from('webhook_deliveries')
      .insert({
        webhook_id: input.webhookId,
        org_id: input.orgId,
        event_type: input.eventType,
        payload: input.payload as NonNullable<Json>,
        status: input.status,
        attempt_count: input.attemptCount,
        last_attempted_at: new Date().toISOString(),
        last_response_status: input.responseStatus,
      })
      .select('id')
      .single()
    if (error) return err(domainError('PRECONDITION_FAILED', `webhook delivery record failed: ${error.message}`))
    return ok(data.id)
  }
}
