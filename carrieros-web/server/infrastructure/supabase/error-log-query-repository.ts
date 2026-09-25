// server/infrastructure/supabase/error-log-query-repository.ts
// app_error_log (migration 0038) is server-only (RLS locked to service_role,
// no anon/authenticated grant at all) — the caller must pass the admin
// service-role client from lib/admin-auth.ts's requireAdminRole(), same as
// every other /api/admin/** route's data access.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ErrorLogFilters, ErrorLogQueryRepository, ErrorLogRow } from '../../ports'

export class SupabaseErrorLogQueryRepository implements ErrorLogQueryRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async list(filters: ErrorLogFilters): Promise<Result<{ rows: readonly ErrorLogRow[]; total: number }>> {
    let query = this.supabase
      .from('app_error_log')
      .select('id, route, message, level, org_id, user_id, request_id, context, created_at, organizations(name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(filters.offset, filters.offset + filters.limit - 1)

    if (filters.routeContains) query = query.ilike('route', `%${filters.routeContains}%`)
    if (filters.orgId !== undefined) query = query.eq('org_id', filters.orgId)
    if (filters.from) query = query.gte('created_at', filters.from)
    if (filters.to) query = query.lte('created_at', filters.to)

    const { data, error, count } = await query
    if (error) return err(domainError('PRECONDITION_FAILED', `error log list failed: ${error.message}`))

    const rows: ErrorLogRow[] = (data ?? []).map((r) => ({
      id: r.id,
      route: r.route,
      message: r.message,
      level: r.level,
      orgId: r.org_id,
      orgName: (r.organizations as { name: string } | null)?.name ?? null,
      userId: r.user_id,
      requestId: r.request_id,
      context: (r.context as Record<string, unknown> | null) ?? null,
      createdAt: r.created_at,
    }))

    return ok({ rows, total: count ?? rows.length })
  }
}
