// server/domain/invoice/draft.ts
// Validation for editing a draft invoice. Pure. Only a DRAFT is editable: once an invoice
// has been sent to the customer its amount is a commitment, so changing it silently would
// misstate what the customer was billed.
import { ok, err, validationFailed, type Result } from '../shared/result'

export interface DraftInput {
  readonly amount: number
  readonly dueDate?: string | null
  readonly notes?: string | null
}

export function buildDraftPatch(input: DraftInput): Result<{ amount: number; dueDate: string | null; notes: string | null }> {
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 10_000_000) {
    return err(validationFailed('Amount must be greater than zero', { amount: 'OUT_OF_RANGE' }))
  }
  if (input.dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
    return err(validationFailed('Due date must be YYYY-MM-DD', { due_date: 'INVALID' }))
  }
  const notes = input.notes?.trim() || null
  if (notes && notes.length > 1000) return err(validationFailed('Notes are too long', { notes: 'TOO_LONG' }))
  return ok({ amount: Math.round(input.amount * 100) / 100, dueDate: input.dueDate ?? null, notes })
}
