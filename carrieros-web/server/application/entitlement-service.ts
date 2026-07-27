// server/application/entitlement-service.ts
// The authoritative entitlement decision for the whole system.
//
// Every mutating operation calls `require()` before doing work. Frontends call
// `project()` to decide what to render. Both go through the same pure decision
// in server/domain/entitlement/model.ts, so a paywall shown in the UI and a
// paywall enforced by the API cannot drift apart — which they can today, since
// the UI reads get_my_entitlements() and the server reads has_feature(), two
// separately-maintained SQL functions.
//
// Imports only domain types and ports. No Supabase, no Next.js, no HTTP.

import {
  decideEntitlement,
  projectAllCapabilities,
  checkUsageLimit,
  asCapabilityKey,
  type CapabilityKey,
  type EntitlementDecision,
  type EntitlementSnapshot,
} from '../domain/entitlement/model'
import { type Result, ok, err, domainError } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { Clock, EntitlementRepository, Logger } from '../ports'

export interface EntitlementServiceDeps {
  readonly repository: EntitlementRepository
  readonly clock: Clock
  readonly logger: Logger
}

export class EntitlementService {
  constructor(private readonly deps: EntitlementServiceDeps) {}

  /**
   * Gate a business operation. Returns a failed Result the caller propagates —
   * it does not throw, because "your plan doesn't include this" is an expected
   * outcome that route handlers map to a 402/403 problem response.
   */
  async require(actor: ActorContext, capability: string): Promise<Result<void>> {
    const decision = await this.decide(actor, capability)
    if (!decision.ok) return decision

    if (decision.value.allowed) return ok(undefined)

    // Denials are logged: a customer repeatedly hitting a paywall is a sales
    // signal, and a customer hitting one they should not be is a bug report.
    this.deps.logger.info('entitlement.denied', {
      orgId: actor.orgId,
      userId: actor.userId,
      capability,
      reason: decision.value.reason,
      correlationId: actor.correlationId,
    })

    // LIMIT/ENTITLEMENT are distinguished so the API can answer correctly:
    // an unknown capability is a server-side bug (the caller asked for
    // something that does not exist) rather than a commercial denial.
    const code =
      decision.value.reason === 'UNKNOWN_CAPABILITY' ? 'VALIDATION_FAILED' : 'ENTITLEMENT_REQUIRED'

    return err(
      domainError(code, decision.value.detail, {
        meta: { capability, reason: decision.value.reason },
      })
    )
  }

  /** Decide without failing — for callers that want to branch on the reason. */
  async decide(actor: ActorContext, capability: string): Promise<Result<EntitlementDecision>> {
    const snapshot = await this.deps.repository.loadSnapshot(actor)
    if (!snapshot.ok) return snapshot
    return ok(decideEntitlement(snapshot.value, asCapabilityKey(capability), this.deps.clock.now()))
  }

  /**
   * The full projection behind `GET /api/v1/entitlements`.
   *
   * Includes the subscription's standing so a client can render "trial ends in
   * 3 days" without deriving it from a list of booleans — the thing that
   * currently pushes tier logic into frontend code.
   */
  async project(actor: ActorContext): Promise<
    Result<{
      capabilities: ReadonlyArray<{ key: CapabilityKey; allowed: boolean; reason: string }>
      subscription: {
        status: EntitlementSnapshot['subscriptionStatus']
        tier: EntitlementSnapshot['tier']
        trialEndsAt: string | null
        gracePeriodUntil: string | null
      }
      limits: EntitlementSnapshot['limits']
    }>
  > {
    const snapshot = await this.deps.repository.loadSnapshot(actor)
    if (!snapshot.ok) return snapshot
    const s = snapshot.value

    return ok({
      capabilities: projectAllCapabilities(s, this.deps.clock.now()),
      subscription: {
        status: s.subscriptionStatus,
        tier: s.tier,
        trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
        gracePeriodUntil: s.gracePeriodUntil?.toISOString() ?? null,
      },
      limits: s.limits,
    })
  }

  /** Metered allowance check, e.g. before adding a truck beyond the plan. */
  async requireWithinLimit(
    actor: ActorContext,
    limitKey: string,
    currentUsage: number
  ): Promise<Result<void>> {
    const snapshot = await this.deps.repository.loadSnapshot(actor)
    if (!snapshot.ok) return snapshot

    const check = checkUsageLimit(snapshot.value, limitKey, currentUsage)
    if (check.withinLimit) return ok(undefined)

    return err(
      domainError('LIMIT_EXCEEDED', `Usage limit "${limitKey}" reached`, {
        meta: { limitKey, currentUsage, included: check.included, hardCap: check.hardCap },
      })
    )
  }

  /**
   * COMPATIBILITY ADAPTER — matches the legacy `hasFeature()` boolean exactly.
   *
   * Exists so the ~21 existing call sites can move to the new engine one at a
   * time instead of in a single risky sweep. It is deliberately lossy in the
   * same way the old function was (a bare boolean, no reason), so nothing new
   * should be written against it.
   *
   * Behaviour difference to be aware of while migrating: this returns FALSE for
   * an org whose trial has expired or whose subscription is canceled, where
   * has_feature() returns TRUE. That is the defect being fixed, so a call site
   * switching over may start denying access it previously allowed — which is
   * correct, and is why the switch is per-site and reviewable rather than
   * global. See architecture/entitlement-model.md for the migration order.
   */
  async hasFeatureCompat(actor: ActorContext, featureKey: string): Promise<boolean> {
    const decision = await this.decide(actor, featureKey)
    if (!decision.ok) return false // fail closed, as the RPC's NULL did
    return decision.value.allowed
  }
}
