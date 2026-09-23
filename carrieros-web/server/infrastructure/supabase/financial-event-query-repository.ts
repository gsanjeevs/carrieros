// server/infrastructure/supabase/financial-event-query-repository.ts
// Reads outbox_events with the service role: the table is deny-all to client
// roles by design (migration 0005). Tenant scoping is the org id from a
// verified ActorContext (for the public API, the OAuth client's own org — see
// buildPublicApiActor), applied to every query. Only the financial event_types
// migration 0033 emits are surfaced here; MilestoneSubmitted and anything else
// in the shared outbox is out of scope for this export.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { FinancialEventQueryRepository, FinancialOutboxRecord } from '../../ports'
import { FINANCIAL_OUTBOX_EVENT_TYPES } from '../../domain/financial-events/categorize'

export class SupabaseFinancialEventQueryRepository implements FinancialEventQueryRepository {
  constructor(private readonly admin: SupabaseClient<Database>) {}

  async listSince(actor: ActorContext, cursor: number, limit: number) {
    // Rule I: currency is resolved from the org's own record, not a literal
    // 'USD' fallback. organizations.currency is NOT NULL (schema default
    // 'USD' only applies at row-creation time, onboarding always sets a real
    // value from the org's country) — this reads whatever that org actually
    // has, once per call.
    const { data: org, error: orgError } = await this.admin
      .from('organizations')
      .select('currency')
      .eq('id', actor.orgId)
      .maybeSingle()
    if (orgError) return err(domainError('PRECONDITION_FAILED', `organization read failed: ${orgError.message}`))
    if (!org) return err(domainError('NOT_FOUND', 'Organization not found'))
    // organizations.currency has no NOT NULL constraint in the schema, so this
    // IS possible for a pre-existing row. Rule I's point is that the source of
    // truth is resolved, not defaulted — so a missing currency here is a real
    // data-completeness gap surfaced as an error, not silently patched to
    // 'USD' (which is exactly the literal-fallback pattern Rule I flags
    // elsewhere as tracked debt; this endpoint must not add a new instance).
    if (!org.currency) return err(domainError('PRECONDITION_FAILED', 'Organization has no currency configured'))

    const { data, error } = await this.admin
      .from('outbox_events')
      .select('id, event_type, payload, occurred_at')
      .eq('org_id', actor.orgId)
      .in('event_type', FINANCIAL_OUTBOX_EVENT_TYPES as unknown as string[])
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(limit)
    if (error) return err(domainError('PRECONDITION_FAILED', `financial events read failed: ${error.message}`))

    const events: FinancialOutboxRecord[] = (data ?? []).map((r) => ({
      id: Number(r.id),
      eventType: r.event_type,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      occurredAt: r.occurred_at,
    }))
    return ok({ events, currency: org.currency })
  }
}
