// server/domain/entitlement/model.ts
// The commercial decision: may THIS organization use THIS capability right now?
//
// WHY THIS EXISTS. The incumbent `has_feature(feature_key)` RPC is a single
// comparison — `rank(carrier_details.tier) >= rank(features.min_tier)`. The
// 2026-07-26 audit confirmed it consults nothing else. Every one of these is
// ignored today:
//
//   billing_status      'past_due' and 'canceled' orgs keep every feature
//   trial_ends_at       an expired trial keeps every feature, forever
//   grace_period_until  set by the admin UI, read by nothing
//   org_flag_overrides  per-org grants/denies, read by nothing
//   platform_flags      kill switches, read by nothing
//
// So the only way to revoke access from a non-paying customer is to mutate
// `tier` — which also destroys the record of what they had bought, and is
// indistinguishable from a downgrade. That is a revenue and support problem,
// not a styling one.
//
// This module separates the concepts the single tier column had collapsed:
// subscription lifecycle, tier package, capability, usage limit, effective
// period, trial, grace, suspension, per-org override, and kill switch. Each is
// evaluated in an explicit, ordered way and the result explains itself.
//
// PURE. No I/O, no Supabase, no clock reads — `now` is passed in. That is what
// makes every branch below unit-testable without a database, which matters
// because these are the branches that decide whether a customer can work.

import type { OrgId } from '../shared/identity'

export type TierCode = 'starter' | 'growth' | 'pro' | 'enterprise'

/** Ranks mirror `tiers.rank`. Higher includes everything lower. */
export const TIER_RANK: Readonly<Record<TierCode, number>> = {
  starter: 1,
  growth: 2,
  pro: 3,
  enterprise: 4,
}

/**
 * Subscription lifecycle, kept SEPARATE from the tier package.
 * Mirrors `carrier_details.billing_status` today, but as its own dimension so
 * "which plan did they buy" and "are they currently paid up" stop being one
 * field. Adding `suspended` here does not require inventing a fake tier.
 */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  /** Operator-initiated stop (abuse, non-payment escalation). Not in the DB yet. */
  | 'suspended'

/** A capability the product can gate on. Language-neutral, stable across locales. */
export type CapabilityKey = string & { readonly __brand: 'CapabilityKey' }
export const asCapabilityKey = (k: string): CapabilityKey => k as CapabilityKey

export interface CapabilityDefinition {
  readonly key: CapabilityKey
  /** Lowest tier that includes this capability. */
  readonly minTier: TierCode
  /**
   * When true, the capability survives trial expiry and past_due — used for
   * things a customer must retain in order to pay you or export their data.
   * Locking someone out of their own invoices for non-payment is how you turn
   * a collections problem into a legal one.
   */
  readonly retainedWhenDelinquent?: boolean
}

/** A metered allowance, e.g. `tiers.included_trucks`. */
export interface UsageLimit {
  readonly key: string
  readonly included: number
  /** null = no hard ceiling; overage is billed rather than blocked. */
  readonly hardCap: number | null
}

/** Per-org grant/deny, overriding the tier package in either direction. */
export interface OrgOverride {
  readonly capability: CapabilityKey
  readonly effect: 'grant' | 'deny'
  /** null = open-ended. */
  readonly expiresAt: Date | null
  readonly reason: string
}

/** Global kill switch / rollout flag. Operational, not commercial. */
export interface PlatformFlag {
  readonly key: string
  readonly enabled: boolean
}

/**
 * Everything needed to decide, gathered by the repository in one read.
 * A snapshot — deliberately not a live handle to the database, so a decision
 * cannot change halfway through evaluating it.
 */
export interface EntitlementSnapshot {
  readonly orgId: OrgId
  readonly subscriptionStatus: SubscriptionStatus
  readonly tier: TierCode
  readonly trialEndsAt: Date | null
  readonly gracePeriodUntil: Date | null
  readonly capabilities: readonly CapabilityDefinition[]
  readonly limits: readonly UsageLimit[]
  readonly overrides: readonly OrgOverride[]
  readonly platformFlags: readonly PlatformFlag[]
  /**
   * Present only for organizations that are not carriers (customer/shipper
   * orgs, the ShipmentX platform org). They have no carrier_details row, which
   * is why has_feature() returns NULL for them today.
   */
  readonly isCarrierOrg: boolean
}

export type EntitlementDecision =
  | { readonly allowed: true; readonly reason: AllowReason }
  | { readonly allowed: false; readonly reason: DenyReason; readonly detail: string }

export type AllowReason =
  | 'INCLUDED_IN_TIER'
  | 'GRANTED_BY_OVERRIDE'
  | 'RETAINED_WHILE_DELINQUENT'
  | 'WITHIN_TRIAL'
  | 'WITHIN_GRACE_PERIOD'

export type DenyReason =
  | 'UNKNOWN_CAPABILITY'
  | 'NOT_A_CARRIER_ORG'
  | 'DENIED_BY_OVERRIDE'
  | 'TIER_TOO_LOW'
  | 'TRIAL_EXPIRED'
  | 'SUBSCRIPTION_CANCELED'
  | 'SUBSCRIPTION_SUSPENDED'
  | 'PAST_DUE_GRACE_EXPIRED'
  | 'DISABLED_BY_PLATFORM_FLAG'

/**
 * The decision. Order matters and is deliberate:
 *
 *   1. Platform kill switch   — operational stop beats every commercial grant.
 *   2. Capability exists      — unknown key denies (fail closed).
 *   3. Org is a carrier       — non-carrier orgs have no subscription at all.
 *   4. Explicit deny override — an operator's "no" beats the package.
 *   5. Subscription standing  — canceled/suspended/expired stop here...
 *   6. ...unless retained     — billing/export survive delinquency.
 *   7. Explicit grant override
 *   8. Tier comparison        — the only rule that exists today.
 *
 * Every branch returns a machine-readable reason so the API can tell a client
 * WHY something is unavailable ("your trial ended") instead of a bare false,
 * which is what forces frontends to reimplement tier logic to build a decent
 * upgrade prompt.
 */
export function decideEntitlement(
  snapshot: EntitlementSnapshot,
  capabilityKey: CapabilityKey,
  now: Date
): EntitlementDecision {
  const flag = snapshot.platformFlags.find((f) => f.key === capabilityKey)
  if (flag && !flag.enabled) {
    return {
      allowed: false,
      reason: 'DISABLED_BY_PLATFORM_FLAG',
      detail: `Capability ${capabilityKey} is disabled platform-wide`,
    }
  }

  const capability = snapshot.capabilities.find((c) => c.key === capabilityKey)
  if (!capability) {
    // Fail closed. A typo'd key must never grant access — and this is a real
    // hazard, since has_feature() returns NULL (falsy, but not false) for an
    // unknown key today, so the two disagree only in how loudly they fail.
    return {
      allowed: false,
      reason: 'UNKNOWN_CAPABILITY',
      detail: `No capability is registered under the key "${capabilityKey}"`,
    }
  }

  if (!snapshot.isCarrierOrg) {
    return {
      allowed: false,
      reason: 'NOT_A_CARRIER_ORG',
      detail: 'Only carrier organizations hold a subscription',
    }
  }

  const denyOverride = snapshot.overrides.find(
    (o) =>
      o.capability === capabilityKey &&
      o.effect === 'deny' &&
      (o.expiresAt === null || o.expiresAt > now)
  )
  if (denyOverride) {
    return {
      allowed: false,
      reason: 'DENIED_BY_OVERRIDE',
      detail: `Explicitly denied for this organization: ${denyOverride.reason}`,
    }
  }

  const standing = evaluateStanding(snapshot, now)
  if (!standing.inGoodStanding) {
    // Delinquency does not remove the capabilities a customer needs in order
    // to settle up or leave with their data.
    if (capability.retainedWhenDelinquent) {
      return { allowed: true, reason: 'RETAINED_WHILE_DELINQUENT' }
    }
    return { allowed: false, reason: standing.reason, detail: standing.detail }
  }

  const grantOverride = snapshot.overrides.find(
    (o) =>
      o.capability === capabilityKey &&
      o.effect === 'grant' &&
      (o.expiresAt === null || o.expiresAt > now)
  )
  if (grantOverride) return { allowed: true, reason: 'GRANTED_BY_OVERRIDE' }

  if (TIER_RANK[snapshot.tier] >= TIER_RANK[capability.minTier]) {
    return { allowed: true, reason: standing.allowReason }
  }

  return {
    allowed: false,
    reason: 'TIER_TOO_LOW',
    detail: `${capabilityKey} requires the ${capability.minTier} plan; this organization is on ${snapshot.tier}`,
  }
}

type Standing =
  | { inGoodStanding: true; allowReason: AllowReason }
  | { inGoodStanding: false; reason: DenyReason; detail: string }

/**
 * Subscription standing, independent of any particular capability.
 *
 * `past_due` deliberately does NOT deny immediately: a failed card retries for
 * days, and cutting a carrier off mid-load because a renewal bounced is worse
 * than carrying them briefly. It denies only once the grace period set by an
 * operator has passed. If no grace was set, past_due is treated as still
 * working — the operator has an explicit lever and has not pulled it.
 */
function evaluateStanding(snapshot: EntitlementSnapshot, now: Date): Standing {
  switch (snapshot.subscriptionStatus) {
    case 'canceled':
      return {
        inGoodStanding: false,
        reason: 'SUBSCRIPTION_CANCELED',
        detail: 'Subscription is canceled',
      }

    case 'suspended':
      return {
        inGoodStanding: false,
        reason: 'SUBSCRIPTION_SUSPENDED',
        detail: 'Subscription is suspended by the platform operator',
      }

    case 'trialing': {
      if (snapshot.trialEndsAt && snapshot.trialEndsAt <= now) {
        if (snapshot.gracePeriodUntil && snapshot.gracePeriodUntil > now) {
          return { inGoodStanding: true, allowReason: 'WITHIN_GRACE_PERIOD' }
        }
        return {
          inGoodStanding: false,
          reason: 'TRIAL_EXPIRED',
          detail: `Trial ended ${snapshot.trialEndsAt.toISOString()}`,
        }
      }
      return { inGoodStanding: true, allowReason: 'WITHIN_TRIAL' }
    }

    case 'past_due': {
      if (snapshot.gracePeriodUntil && snapshot.gracePeriodUntil <= now) {
        return {
          inGoodStanding: false,
          reason: 'PAST_DUE_GRACE_EXPIRED',
          detail: `Payment is past due and the grace period ended ${snapshot.gracePeriodUntil.toISOString()}`,
        }
      }
      return { inGoodStanding: true, allowReason: 'WITHIN_GRACE_PERIOD' }
    }

    case 'active':
    default:
      return { inGoodStanding: true, allowReason: 'INCLUDED_IN_TIER' }
  }
}

/** Usage-limit check, separate from capability access. */
export function checkUsageLimit(
  snapshot: EntitlementSnapshot,
  limitKey: string,
  currentUsage: number
): { readonly withinLimit: boolean; readonly included: number; readonly hardCap: number | null } {
  const limit = snapshot.limits.find((l) => l.key === limitKey)
  // An unregistered limit is not a licence to ignore limits, but neither is it
  // grounds to block: the caller decides. Reported as unlimited with included=0
  // so the shape stays honest rather than inventing a ceiling.
  if (!limit) return { withinLimit: true, included: 0, hardCap: null }
  if (limit.hardCap === null) return { withinLimit: true, included: limit.included, hardCap: null }
  return { withinLimit: currentUsage < limit.hardCap, included: limit.included, hardCap: limit.hardCap }
}

/**
 * Bulk projection for the frontend's navigation/action rendering.
 *
 * Frontends call this to decide what to SHOW. It is never the security
 * control — every mutating operation re-decides server-side in the application
 * service. Returning the reason lets the UI render "Upgrade to Growth" rather
 * than silently hiding a feature, which is the difference between a paywall
 * that sells and one that confuses.
 */
export function projectAllCapabilities(
  snapshot: EntitlementSnapshot,
  now: Date
): ReadonlyArray<{ key: CapabilityKey; allowed: boolean; reason: string }> {
  return snapshot.capabilities.map((c) => {
    const d = decideEntitlement(snapshot, c.key, now)
    return { key: c.key, allowed: d.allowed, reason: d.reason }
  })
}
