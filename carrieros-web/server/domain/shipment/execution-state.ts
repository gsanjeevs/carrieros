// server/domain/shipment/execution-state.ts
// The execution lifecycle of a shipment, as its own dimension.
//
// WHY THIS IS NOT `loads.status`. The existing column conflates three
// independent concerns into one vocabulary:
//
//   execution     draft, scheduled, dispatched, picked_up, in_transit, delivered
//   billing       invoiced, paid
//   termination   cancelled, declined
//
// Because they share one column, a load cannot be "delivered AND invoiced" —
// moving to `invoiced` erases the fact that it was delivered. Cancellation
// likewise destroys the execution history rather than annotating it. And every
// consumer that branches on `status` is implicitly coupled to all three
// concerns: a change to billing states forces a re-review of dispatch code.
//
// This module models EXECUTION only. Billing and termination become separate
// dimensions (see the migration plan in architecture/). Until the column is
// split, `toLegacyStatus`/`fromLegacyStatus` map between the two
// representations so this can be adopted incrementally without a schema change
// and without breaking the ~40 places that read `loads.status` today.
//
// Pure: no I/O, no framework. Transition legality is a domain rule, so it is
// testable without a database.

import { type Result, ok, err, illegalTransition, validationFailed } from '../shared/result'

/** Execution states. Language-neutral and stable across the API. */
export type ExecutionState =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'DISPATCHED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'

/** Terminal outcomes, tracked separately so they do not erase execution history. */
export type TerminationState = 'CANCELLED' | 'DECLINED'

export const EXECUTION_STATES: readonly ExecutionState[] = [
  'DRAFT',
  'SCHEDULED',
  'DISPATCHED',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
]

/**
 * Legal forward transitions.
 *
 * Deliberately strict, and deliberately NOT applied to the legacy
 * `PATCH /api/loads/:id` route, which today accepts any status from any other
 * status with no checks at all. Enforcing this on the existing path would be a
 * silent behaviour change to flows that currently work (including, possibly,
 * ones that legitimately skip a step). The new /api/v1 command path is strict;
 * the legacy path is left alone until its call sites migrate, which is what
 * makes this adoptable without a coordinated cutover.
 *
 * `PICKED_UP -> IN_TRANSIT` and `DISPATCHED -> PICKED_UP` are the ordinary
 * path. `DISPATCHED -> IN_TRANSIT` is permitted because drivers routinely
 * forget to mark pickup and report it once already rolling; refusing that
 * produces false data, not better data.
 */
const LEGAL_TRANSITIONS: Readonly<Record<ExecutionState, readonly ExecutionState[]>> = {
  DRAFT: ['SCHEDULED', 'DISPATCHED'],
  SCHEDULED: ['DISPATCHED'],
  DISPATCHED: ['PICKED_UP', 'IN_TRANSIT'],
  PICKED_UP: ['IN_TRANSIT'],
  IN_TRANSIT: ['DELIVERED'],
  DELIVERED: [],
}

export function canTransition(from: ExecutionState, to: ExecutionState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to)
}

/** Everything a transition must record, per the audit requirements. */
export interface TransitionRecord {
  readonly priorState: ExecutionState
  readonly newState: ExecutionState
  readonly reason: string | null
  readonly effectiveAt: Date
  /** The version the actor believed they were changing. */
  readonly expectedVersion: number
}

export function transition(
  current: ExecutionState,
  requested: ExecutionState,
  opts: { reason?: string | null; effectiveAt: Date; expectedVersion: number }
): Result<TransitionRecord> {
  if (current === requested) {
    // Not an error and not a state change: a retried request or a double-tap
    // should be absorbed, not rejected. The caller treats a null result as
    // "already there" and returns the existing resource.
    return err(
      validationFailed(`Shipment is already ${requested}`, { state: 'ALREADY_IN_STATE' })
    )
  }
  if (!canTransition(current, requested)) {
    return err(illegalTransition(current, requested, 'Shipment execution'))
  }
  return ok({
    priorState: current,
    newState: requested,
    reason: opts.reason ?? null,
    effectiveAt: opts.effectiveAt,
    expectedVersion: opts.expectedVersion,
  })
}

// ── Legacy column mapping ───────────────────────────────────────────────────
// Kept in this module rather than in an adapter so the two representations
// cannot drift: adding an ExecutionState without deciding its legacy spelling
// is a compile error.

const TO_LEGACY: Readonly<Record<ExecutionState, string>> = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  DISPATCHED: 'dispatched',
  PICKED_UP: 'picked_up',
  IN_TRANSIT: 'in_transit',
  DELIVERED: 'delivered',
}

const FROM_LEGACY: Readonly<Record<string, ExecutionState>> = {
  draft: 'DRAFT',
  scheduled: 'SCHEDULED',
  dispatched: 'DISPATCHED',
  picked_up: 'PICKED_UP',
  in_transit: 'IN_TRANSIT',
  delivered: 'DELIVERED',
}

export function toLegacyStatus(state: ExecutionState): string {
  return TO_LEGACY[state]
}

/**
 * Map a legacy `loads.status` value to an execution state.
 *
 * Returns null for `invoiced`/`paid`/`cancelled`/`declined` — those are NOT
 * execution states, and quietly coercing them (say, treating `invoiced` as
 * `DELIVERED`) would let a billing state be mistaken for an executable one and
 * allow a transition off it. Callers must handle null as "this shipment is no
 * longer in the execution phase".
 */
export function fromLegacyStatus(status: string): ExecutionState | null {
  return FROM_LEGACY[status] ?? null
}

/** Legacy values that mean execution has finished or been abandoned. */
export function isPostExecutionStatus(status: string): boolean {
  return ['invoiced', 'paid', 'cancelled', 'declined'].includes(status)
}

/**
 * The `load_events.event_type` string the existing system writes.
 * Preserved exactly so the new command path produces events indistinguishable
 * from the old one — the timeline UI reads these, and a slice that quietly
 * changed their spelling would break history rendering for migrated loads.
 */
export function legacyEventType(state: ExecutionState): string {
  return `status_${toLegacyStatus(state)}`
}
