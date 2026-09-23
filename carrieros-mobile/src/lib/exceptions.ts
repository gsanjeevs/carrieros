// src/lib/exceptions.ts
// Shared helper around GET /api/v1/exceptions (get_exceptions(), org-scoped
// and role-filtered server-side — see server/application/exception-query-
// service.ts), so the tier-priority sort used to pick a single "top"
// exception per entity lives in one place, shared by the Alerts tab and the
// inline per-row chips on Fleet/Customers.
import { apiClient } from '@/lib/api-client';

export type ExceptionTier = 'today' | 'this_week' | 'upcoming';

export type ExceptionRow = {
  entity_type: string;
  entity_id: number;
  exception_type: string;
  tier: string;
  title: string;
  detail: string;
  due_at: string | null;
};

export const TIER_ORDER: ExceptionTier[] = ['today', 'this_week', 'upcoming'];

function sortKey(row: ExceptionRow): [number, number] {
  const tierRank = TIER_ORDER.indexOf(row.tier as ExceptionTier);
  const due = row.due_at ? new Date(row.due_at).getTime() : Number.POSITIVE_INFINITY;
  return [tierRank === -1 ? TIER_ORDER.length : tierRank, due];
}

// Most-urgent-first: tier (today, then this_week, then upcoming), then
// due_at ascending within a tier.
export function sortExceptions(rows: ExceptionRow[]): ExceptionRow[] {
  return [...rows].sort((a, b) => {
    const [aTier, aDue] = sortKey(a);
    const [bTier, bDue] = sortKey(b);
    return aTier !== bTier ? aTier - bTier : aDue - bDue;
  });
}

export async function fetchExceptions(): Promise<ExceptionRow[]> {
  const { data } = await apiClient.http.GET('/api/v1/exceptions');
  return sortExceptions((data?.exceptions as ExceptionRow[] | undefined) ?? []);
}

// Builds entity_type -> (entity_id -> top exception) so callers can look up
// a single row's top exception in O(1). Rows are assumed already sorted
// most-urgent-first (e.g. via fetchExceptions()/sortExceptions() above).
export function topExceptionByEntity(
  rows: ExceptionRow[],
  entityType: string
): Map<number, ExceptionRow> {
  const map = new Map<number, ExceptionRow>();
  for (const row of rows) {
    if (row.entity_type === entityType && !map.has(row.entity_id)) {
      map.set(row.entity_id, row);
    }
  }
  return map;
}
