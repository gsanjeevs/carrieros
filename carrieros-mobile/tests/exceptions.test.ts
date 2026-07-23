// tests/exceptions.test.ts
// Pure-logic tests for src/lib/exceptions.ts's sortExceptions() and
// topExceptionByEntity() — deliberately NOT testing fetchExceptions()
// (would require mocking the Supabase client; out of scope for this first
// pass, see docs/architecture-principles.md Rule G's plan sketch).
import { sortExceptions, topExceptionByEntity, type ExceptionRow } from '@/lib/exceptions';

function row(overrides: Partial<ExceptionRow>): ExceptionRow {
  return {
    entity_type: 'load',
    entity_id: 1,
    exception_type: 'invoice_overdue',
    tier: 'today',
    title: 'title',
    detail: 'detail',
    due_at: null,
    ...overrides,
  };
}

describe('sortExceptions', () => {
  it('sorts tier-first: today before this_week before upcoming', () => {
    const rows = [
      row({ entity_id: 1, tier: 'upcoming' }),
      row({ entity_id: 2, tier: 'today' }),
      row({ entity_id: 3, tier: 'this_week' }),
    ];
    const sorted = sortExceptions(rows);
    expect(sorted.map((r) => r.entity_id)).toEqual([2, 3, 1]);
  });

  it('within the same tier, sorts by due_at ascending', () => {
    const rows = [
      row({ entity_id: 1, tier: 'today', due_at: '2026-07-10T00:00:00Z' }),
      row({ entity_id: 2, tier: 'today', due_at: '2026-07-01T00:00:00Z' }),
      row({ entity_id: 3, tier: 'today', due_at: '2026-07-05T00:00:00Z' }),
    ];
    const sorted = sortExceptions(rows);
    expect(sorted.map((r) => r.entity_id)).toEqual([2, 3, 1]);
  });

  it('a null due_at sorts last within its tier', () => {
    const rows = [
      row({ entity_id: 1, tier: 'today', due_at: null }),
      row({ entity_id: 2, tier: 'today', due_at: '2026-07-01T00:00:00Z' }),
    ];
    const sorted = sortExceptions(rows);
    expect(sorted.map((r) => r.entity_id)).toEqual([2, 1]);
  });

  it('does not mutate the input array', () => {
    const rows = [row({ entity_id: 1, tier: 'upcoming' }), row({ entity_id: 2, tier: 'today' })];
    const original = [...rows];
    sortExceptions(rows);
    expect(rows).toEqual(original);
  });
});

describe('topExceptionByEntity', () => {
  it('keeps only the first (most-urgent, given pre-sorted input) row per entity_id', () => {
    const rows = [
      row({ entity_type: 'driver', entity_id: 1, tier: 'today', title: 'first' }),
      row({ entity_type: 'driver', entity_id: 1, tier: 'this_week', title: 'second' }),
      row({ entity_type: 'driver', entity_id: 2, tier: 'today', title: 'other driver' }),
    ];
    const map = topExceptionByEntity(rows, 'driver');
    expect(map.get(1)?.title).toBe('first');
    expect(map.get(2)?.title).toBe('other driver');
    expect(map.size).toBe(2);
  });

  it('ignores rows of a different entity_type', () => {
    const rows = [
      row({ entity_type: 'load', entity_id: 1 }),
      row({ entity_type: 'driver', entity_id: 1 }),
    ];
    const map = topExceptionByEntity(rows, 'vehicle');
    expect(map.size).toBe(0);
  });
});
