// lib/domain/invite-status.ts
// Rule A of docs/architecture-principles.md — shared source for
// drivers.invite_status color mapping. Same exhaustive-switch pattern as
// lib/domain/load-status.ts: a new invite_status value added to the DB CHECK
// constraint with no matching case here fails `tsc`, not silently blank.
//
// Consolidates a drift found during Wave 2 page migration (2026-07-22):
// app/(app)/drivers/page.tsx and app/(app)/drivers/[driver_number]/page.tsx
// each carried their own identical STATUS_COLOR/INVITE_STATUS_COLOR const.
export type InviteStatus = 'pending' | 'accepted' | 'revoked'

export const INVITE_STATUSES: readonly InviteStatus[] = ['pending', 'accepted', 'revoked']

export function inviteStatusColor(status: InviteStatus): string {
  switch (status) {
    case 'pending':
      return 'bg-amber-500/20 text-amber-400'
    case 'accepted':
      return 'bg-[#16a34a]/20 text-[#16a34a]'
    case 'revoked':
      return 'bg-slate-500/20 text-slate-400'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

export const INVITE_STATUS_COLOR: Record<string, string> = Object.fromEntries(
  INVITE_STATUSES.map(s => [s, inviteStatusColor(s)])
)

// Maps to components/ui/StatusBadge.tsx's variant union — see
// load-status.ts's loadStatusVariant() for why this stays a hand-duplicated
// literal union rather than importing StatusBadgeVariant here.
export type StatusBadgeVariant =
  | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' | 'teal' | 'purple'

export function inviteStatusVariant(status: InviteStatus): StatusBadgeVariant {
  switch (status) {
    case 'pending':
      return 'warning'
    case 'accepted':
      return 'success'
    case 'revoked':
      return 'neutral'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}
