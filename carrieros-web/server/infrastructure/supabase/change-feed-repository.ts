// server/infrastructure/supabase/change-feed-repository.ts
// Reads change_events with the service role: the table is deny-all to client
// roles by design (migration 0012). Tenant scoping is the org id the caller
// passes from a verified ActorContext, applied in every query.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ChangeEntity } from '../../domain/events/entities'
import type { ChangeFeedRepository, ChangeSignal } from '../../ports'

export class SupabaseChangeFeedRepository implements ChangeFeedRepository {
  constructor(private readonly admin: SupabaseClient<Database>) {}

  async latestId(orgId: number): Promise<Result<number>> {
    const { data, error } = await this.admin
      .from('change_events')
      .select('id')
      .eq('org_id', orgId)
      .order('id', { ascending: false })
      .limit(1)
    if (error) return err(domainError('PRECONDITION_FAILED', `change feed read failed: ${error.message}`))
    return ok(data?.[0] ? Number(data[0].id) : 0)
  }

  async readAfter(orgId: number, afterId: number, limit: number): Promise<Result<readonly ChangeSignal[]>> {
    const { data, error } = await this.admin
      .from('change_events')
      .select('id, entity')
      .eq('org_id', orgId)
      .gt('id', afterId)
      .order('id', { ascending: true })
      .limit(limit)
    if (error) return err(domainError('PRECONDITION_FAILED', `change feed read failed: ${error.message}`))
    return ok((data ?? []).map((r) => ({ id: Number(r.id), entity: r.entity as ChangeEntity })))
  }

  async pruneOlderThan(cutoff: Date): Promise<Result<void>> {
    const { error } = await this.admin
      .from('change_events')
      .delete()
      .lt('created_at', cutoff.toISOString())
    if (error) return err(domainError('PRECONDITION_FAILED', `change feed prune failed: ${error.message}`))
    return ok(undefined)
  }
}
