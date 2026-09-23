// server/domain/financial-events/categorize.ts
// Chart-of-accounts-style categorization for the financial-events export (T19
// readiness layer). Pure and DB-free: given an outbox event_type and its
// payload, decide which ledger bucket an eventual accounting sync would post
// it to. Kept out of infrastructure deliberately — this is a business rule
// ("an invoice is revenue, a settlement is driver pay"), not a query.
export type FinancialEventCategory =
  | 'revenue:freight'
  | 'expense:driver_pay'
  | 'expense:toll'
  | 'expense:lumper'
  | 'expense:scale'
  | 'expense:other'

const INVOICE_EVENT_TYPES = new Set(['InvoiceCreated', 'InvoiceSent', 'InvoicePaid'])
const SETTLEMENT_EVENT_TYPES = new Set(['DriverSettlementCreated', 'DriverSettlementPaymentStatusChanged'])
const EXPENSE_TYPE_TO_CATEGORY: Record<string, FinancialEventCategory> = {
  toll: 'expense:toll',
  lumper: 'expense:lumper',
  scale: 'expense:scale',
  other: 'expense:other',
}

/** The full set of event_type values this export surfaces — everything else in outbox_events (e.g. MilestoneSubmitted) is out of scope. */
export const FINANCIAL_OUTBOX_EVENT_TYPES = [
  'InvoiceCreated',
  'InvoiceSent',
  'InvoicePaid',
  'DriverSettlementCreated',
  'DriverSettlementPaymentStatusChanged',
  'LoadExpenseRecorded',
] as const

export function categorize(eventType: string, payload: Record<string, unknown>): FinancialEventCategory | null {
  if (INVOICE_EVENT_TYPES.has(eventType)) return 'revenue:freight'
  if (SETTLEMENT_EVENT_TYPES.has(eventType)) return 'expense:driver_pay'
  if (eventType === 'LoadExpenseRecorded') {
    const expenseType = typeof payload.expenseType === 'string' ? payload.expenseType : 'other'
    return EXPENSE_TYPE_TO_CATEGORY[expenseType] ?? 'expense:other'
  }
  return null
}

/** The amount an accounting sync would book for this event, from its outbox payload. */
export function amountFor(eventType: string, payload: Record<string, unknown>): number {
  if (INVOICE_EVENT_TYPES.has(eventType)) return Number(payload.amount ?? 0)
  if (SETTLEMENT_EVENT_TYPES.has(eventType)) return Number(payload.netPay ?? 0)
  if (eventType === 'LoadExpenseRecorded') return Number(payload.amount ?? 0)
  return 0
}
