// lib/domain/settlement-status.ts
// Rule A of docs/architecture-principles.md — shared source for
// driver_settlements.payment_status color mapping (schema.sql: pending/sent/cleared).
export type SettlementStatus = 'pending' | 'sent' | 'cleared'

export const SETTLEMENT_STATUSES: readonly SettlementStatus[] = ['pending', 'sent', 'cleared']

export type StatusBadgeVariant =
  | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' | 'teal' | 'purple'

export function settlementStatusVariant(status: SettlementStatus): StatusBadgeVariant {
  switch (status) {
    case 'pending':
      return 'warning'
    case 'sent':
      return 'info'
    case 'cleared':
      return 'success'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}
