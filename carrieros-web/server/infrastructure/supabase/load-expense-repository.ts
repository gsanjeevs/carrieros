// server/infrastructure/supabase/load-expense-repository.ts
// Load expense writes through the CALLER'S client. The atomic insert + outbox
// event is a SECURITY DEFINER function (record_load_expense_command, migration
// 0033) because outbox_events is deny-all to `authenticated` — the function
// re-establishes the tenant + role + tier checks explicitly, same shape as
// submit_shipment_milestone.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { LoadExpenseCommandRepository, LoadExpenseRecord } from '../../ports'

export class SupabaseLoadExpenseRepository implements LoadExpenseCommandRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async record(actor: ActorContext, loadId: number, record: LoadExpenseRecord, idempotencyKey: string) {
    const { data, error } = await this.supabase.rpc('record_load_expense_command', {
      p_load_id: loadId,
      p_expense_type: record.expenseType,
      p_amount: record.amount,
      p_note: record.note as string,
      p_correlation_id: actor.correlationId,
      // Namespaced so this endpoint's client-supplied Idempotency-Key never
      // collides with another aggregate's outbox key of the same value.
      p_idempotency_key: `load-expense:${loadId}:${idempotencyKey}`,
    })
    if (error) {
      if (error.message?.includes('NOT_FOUND') || error.code === 'P0002') return err(domainError('NOT_FOUND', 'Load not found'))
      if (error.message?.includes('FORBIDDEN')) return err(domainError('FORBIDDEN', 'This role cannot log expenses', { meta: { role: actor.role } }))
      if (error.message?.includes('TIER_UPGRADE_REQUIRED')) {
        return err(domainError('ENTITLEMENT_REQUIRED', 'Load expenses require the Growth plan or above'))
      }
      return err(domainError('PRECONDITION_FAILED', `expense insert failed: ${error.message}`))
    }
    const row = data as unknown as { outcome: 'APPLIED' | 'REPLAYED'; id: number; amount: number }
    return ok({ id: Number(row.id), amount: Number(row.amount), outcome: row.outcome })
  }
}
