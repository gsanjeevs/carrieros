// lib/domain/invoice-status.ts
// Rule A of docs/architecture-principles.md — shared source for
// invoices.status color mapping (schema.sql: draft/sent/paid/overdue).
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue'

export const INVOICE_STATUSES: readonly InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue']

export function invoiceStatusColor(status: InvoiceStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-slate-500/20 text-slate-400'
    case 'sent':
      return 'bg-blue-500/20 text-blue-400'
    case 'paid':
      return 'bg-success/20 text-success'
    case 'overdue':
      return 'bg-red-500/20 text-red-400'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

export const INVOICE_STATUS_COLOR: Record<string, string> = Object.fromEntries(
  INVOICE_STATUSES.map(s => [s, invoiceStatusColor(s)])
)

// Maps to components/ui/StatusBadge.tsx's variant union — see
// load-status.ts's loadStatusVariant() for why this stays a hand-duplicated
// literal union rather than importing StatusBadgeVariant here.
export type StatusBadgeVariant =
  | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' | 'teal' | 'purple'

export function invoiceStatusVariant(status: InvoiceStatus): StatusBadgeVariant {
  switch (status) {
    case 'draft':
      return 'neutral'
    case 'sent':
      return 'info'
    case 'paid':
      return 'success'
    case 'overdue':
      return 'danger'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}
