// server/application/load-expense-service.ts
// Logging an expense against a load (toll, lumper, scale, other) — the first
// write path load_expenses has ever had (T19 readiness layer). Gated the same
// way as its own RLS ('owner_solo_dispatcher_load_expenses_all'): no capability
// named specifically for this yet, so this reuses 'loads_manage', whose role
// set (owner/solo/dispatcher) already matches that policy exactly. Retry-safe
// via Idempotency-Key, same withIdempotency wrapper every other v1 command uses.
import { buildLoadExpense } from '../domain/load-expense/record'
import type { Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { IdempotencyRepository, LoadExpenseCommandRepository, ShipmentAccessRepository } from '../ports'
import { withIdempotency } from './idempotency'
import { authorizeLoadAction } from './load-access'

export class LoadExpenseService {
  constructor(
    private readonly deps: {
      readonly shipments: ShipmentAccessRepository
      readonly expenses: LoadExpenseCommandRepository
      readonly idempotency: IdempotencyRepository
    }
  ) {}

  async recordExpense(
    actor: ActorContext,
    loadId: number,
    input: { expenseType: string; amount: number; note?: string | null },
    idempotencyKey: string
  ): Promise<Result<{ id: number; amount: number }>> {
    const draft = buildLoadExpense(input)
    if (!draft.ok) return draft

    return withIdempotency(this.deps.idempotency, actor, `POST /loads/${loadId}/expenses`, idempotencyKey, input, async () => {
      const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, 'loads_manage', 'log an expense')
      if (!access.ok) return access

      const recorded = await this.deps.expenses.record(actor, loadId, draft.value, idempotencyKey)
      if (!recorded.ok) return recorded
      return { ok: true as const, value: { id: recorded.value.id, amount: recorded.value.amount } }
    })
  }
}
