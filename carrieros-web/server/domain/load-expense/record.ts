// server/domain/load-expense/record.ts
// A load expense (toll, lumper, scale, etc.) logged against a load. This is the
// first write path load_expenses has ever had — the table existed from Phase 7B
// but nothing wrote to it. expense_type's comment in schema.sql documents the
// intended vocabulary ("'toll'|'lumper'|'scale'|'other' -- exact set TBD at UI
// time"); it is finalized here rather than left as a free-text column so a
// financial export can categorize it (T19 readiness layer).
import { ok, err, validationFailed, type Result } from '../shared/result'

export const LOAD_EXPENSE_TYPES = ['toll', 'lumper', 'scale', 'other'] as const
export type LoadExpenseType = (typeof LOAD_EXPENSE_TYPES)[number]

export interface LoadExpenseDraft {
  readonly expenseType: LoadExpenseType
  readonly amount: number
  readonly note: string | null
}

export function buildLoadExpense(input: {
  expenseType: string
  amount: number
  note?: string | null
}): Result<LoadExpenseDraft> {
  if (!(LOAD_EXPENSE_TYPES as readonly string[]).includes(input.expenseType)) {
    return err(validationFailed('Unknown expense type', { expense_type: 'INVALID' }))
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return err(validationFailed('Amount must be a positive number', { amount: 'INVALID' }))
  }
  const note = input.note?.trim() || null
  if (note && note.length > 1000) return err(validationFailed('Note is too long', { note: 'TOO_LONG' }))
  return ok({ expenseType: input.expenseType as LoadExpenseType, amount: input.amount, note })
}
