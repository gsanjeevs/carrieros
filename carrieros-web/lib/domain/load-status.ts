// lib/domain/load-status.ts
// Rule A of docs/architecture-principles.md — a single shared source for
// loads.status's color mapping, with an exhaustive switch so a new status
// value added to the DB CHECK constraint with no matching case here is a
// TypeScript compile error, not a silently blank/wrong render.
//
// Consolidates a real drift found 2026-07-22: the loads list page used
// `bg-[#16a34a]/20 text-[#16a34a]` for delivered/paid while the load detail
// page used `bg-green-500/20 text-green-400` — visually similar, not the
// same token. This module picks the hex-based value (matches the design
// token already used in 3 of 4 consuming files), consolidating a decision
// that had drifted rather than been made once.
//
// Deliberately NOT consumed by app/track/[token]/page.tsx — that page has
// its own pre-existing, deliberate isolation comment ("must keep working
// even if that module changes") since it's a public/anon-facing security
// boundary, not the kind of duplication this module is meant to eliminate.
//
// Not yet shared with carrieros-mobile (separate TS setup, no shared
// package today) — mobile's own copy lives in
// carrieros-mobile/src/constants/theme.ts and is unaffected by this file.
export type LoadStatus =
  | 'draft'
  | 'scheduled'
  | 'dispatched'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'invoiced'
  | 'paid'
  | 'cancelled'

export const LOAD_STATUSES: readonly LoadStatus[] = [
  'draft',
  'scheduled',
  'dispatched',
  'picked_up',
  'in_transit',
  'delivered',
  'invoiced',
  'paid',
  'cancelled',
]

export function loadStatusColor(status: LoadStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-slate-500/20 text-slate-400'
    case 'scheduled':
      return 'bg-blue-500/20 text-blue-400'
    case 'dispatched':
      return 'bg-[#f97316]/20 text-[#f97316]'
    case 'picked_up':
      return 'bg-amber-500/20 text-amber-400'
    case 'in_transit':
      return 'bg-[#1abc9c]/20 text-[#1abc9c]'
    case 'delivered':
      return 'bg-[#16a34a]/20 text-[#16a34a]'
    case 'invoiced':
      return 'bg-purple-500/20 text-purple-400'
    case 'paid':
      return 'bg-[#16a34a]/20 text-[#16a34a]'
    case 'cancelled':
      return 'bg-rose-500/10 text-rose-400'
    default: {
      // Compile-time exhaustiveness check — a new LOAD_STATUS value with no
      // case above fails `tsc`, not silently renders blank.
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

// Record-based lookup for call sites that index by an arbitrary/possibly
// invalid string (e.g. straight off a DB row typed as `string`), falling
// back to the 'draft' treatment rather than throwing.
export const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  LOAD_STATUSES.map(s => [s, loadStatusColor(s)])
)

// Maps to components/ui/StatusBadge.tsx's variant union (2026-07-22 —
// that component is generic/semantic, it has no idea `loads.status` exists,
// so this mapping is what a call site uses to pick a variant:
// `<StatusBadge variant={loadStatusVariant(load.status)}>`. Deliberately not
// importing StatusBadgeVariant's type from components/ui here — this module
// stays UI-component-agnostic (domain logic shouldn't depend on a specific
// component library), so the return type is a plain string-literal union
// that must be kept in sync with StatusBadge's variant list by hand. If
// StatusBadge's variants ever change, update the switch below to match.
export type StatusBadgeVariant =
  | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' | 'teal' | 'purple'

export function loadStatusVariant(status: LoadStatus): StatusBadgeVariant {
  switch (status) {
    case 'draft':
      return 'neutral'
    case 'scheduled':
      return 'info'
    case 'dispatched':
      return 'brand'
    case 'picked_up':
      return 'warning'
    case 'in_transit':
      return 'teal'
    case 'delivered':
      return 'success'
    case 'invoiced':
      return 'purple'
    case 'paid':
      return 'success'
    case 'cancelled':
      return 'danger'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}
