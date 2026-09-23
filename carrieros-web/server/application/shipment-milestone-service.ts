// server/application/shipment-milestone-service.ts
// Use case: advance a shipment to its next execution status.
//
// This is where the rules live that the database function deliberately does NOT
// contain (see migration 0006): who may do it, that the transition is legal, and
// that a driver may only touch their own load. The function beneath is
// SECURITY DEFINER and bypasses RLS, so skipping this layer would let any member
// of an org advance any load in it.
//
// Imports only domain and ports.

import {
  fromLegacyStatus,
  legacyEventType,
  transition,
} from '../domain/shipment/execution-state'
import { err, validationFailed, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { Clock, MilestoneOutcome, ShipmentCommandRepository } from '../ports'
import { authorizeLoadAction } from './load-access'

// Deliberately narrower than today's RLS, which also lets `finance` UPDATE loads:
// advancing a shipment is a dispatch/driving action, not a billing one.

export interface SubmitMilestoneInput {
  readonly loadId: number
  /** Null/undefined = advance from whatever the server currently holds. */
  readonly expectedStatus?: string | null
  readonly newStatus: string
  readonly reason?: string | null
  readonly idempotencyKey: string
  readonly occurredAt?: Date
}

export class ShipmentMilestoneService {
  constructor(private readonly deps: { readonly shipments: ShipmentCommandRepository; readonly clock: Clock }) {}

  async submit(actor: ActorContext, input: SubmitMilestoneInput): Promise<Result<MilestoneOutcome>> {
    const target = fromLegacyStatus(input.newStatus)
    if (!target) {
      return err(validationFailed(`"${input.newStatus}" is not an execution status`, { new_status: 'NOT_EXECUTION_STATUS' }))
    }

    const access = await authorizeLoadAction(this.deps.shipments, actor, input.loadId, 'loads_advance_status', 'advance a shipment')
    if (!access.ok) return access
    const found = { value: access.value.load }

    const expectedLegacy = input.expectedStatus ?? found.value.status
    const from = fromLegacyStatus(expectedLegacy)
    if (!from) {
      return err(validationFailed(`Shipment is in "${expectedLegacy}", which is not an execution status`, { expected_status: 'NOT_EXECUTION_STATUS' }))
    }

    const now = this.deps.clock.now()
    const decision = transition(from, target, { reason: input.reason, effectiveAt: input.occurredAt ?? now, expectedVersion: 0 })
    if (!decision.ok) return decision

    return this.deps.shipments.submitMilestone(actor, {
      loadId: input.loadId,
      expectedStatus: expectedLegacy,
      newStatus: input.newStatus,
      eventType: legacyEventType(target),
      reason: input.reason ?? null,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.occurredAt ?? now,
    })
  }
}
