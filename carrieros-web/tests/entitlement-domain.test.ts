// tests/entitlement-domain.test.ts
// Pure unit tests for the entitlement decision. No database, no network — the
// decision is a pure function of (snapshot, capability, now), which is the
// whole point of moving it out of SQL.
//
// Several cases below are written specifically to pin the defects the
// 2026-07-26 audit found in `has_feature()`. Each is marked REGRESSION and
// asserts the NEW, correct behaviour. If any of them start failing, the
// commercial gate has quietly reverted to "tier rank only".

import { describe, it, expect } from 'vitest'
import {
  decideEntitlement,
  checkUsageLimit,
  projectAllCapabilities,
  asCapabilityKey,
  type EntitlementSnapshot,
  type TierCode,
} from '@/server/domain/entitlement/model'
import { asOrgId } from '@/server/domain/shared/identity'

const NOW = new Date('2026-07-26T12:00:00.000Z')
const YESTERDAY = new Date('2026-07-25T12:00:00.000Z')
const TOMORROW = new Date('2026-07-27T12:00:00.000Z')

const DRIVER_CHAT = asCapabilityKey('driver_chat') // growth+
const INVOICING = asCapabilityKey('invoicing') // starter, retained when delinquent

function snapshot(overrides: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot {
  return {
    orgId: asOrgId(12),
    subscriptionStatus: 'active',
    tier: 'growth',
    trialEndsAt: null,
    gracePeriodUntil: null,
    isCarrierOrg: true,
    capabilities: [
      { key: DRIVER_CHAT, minTier: 'growth' },
      { key: INVOICING, minTier: 'starter', retainedWhenDelinquent: true },
    ],
    limits: [{ key: 'trucks', included: 3, hardCap: 10 }],
    overrides: [],
    platformFlags: [],
    ...overrides,
  }
}

describe('tier comparison (parity with the legacy behaviour)', () => {
  it('allows a capability included in the org tier', () => {
    const d = decideEntitlement(snapshot({ tier: 'growth' }), DRIVER_CHAT, NOW)
    expect(d.allowed).toBe(true)
  })

  it('denies a capability above the org tier, and says which plan is needed', () => {
    const d = decideEntitlement(snapshot({ tier: 'starter' }), DRIVER_CHAT, NOW)
    expect(d.allowed).toBe(false)
    if (d.allowed) throw new Error('unreachable')
    expect(d.reason).toBe('TIER_TOO_LOW')
    expect(d.detail).toContain('growth')
  })

  it('a higher tier includes lower-tier capabilities', () => {
    for (const tier of ['growth', 'pro', 'enterprise'] as TierCode[]) {
      expect(decideEntitlement(snapshot({ tier }), DRIVER_CHAT, NOW).allowed).toBe(true)
    }
  })
})

describe('REGRESSION — subscription standing is now consulted', () => {
  // has_feature() ignores billing_status entirely: a canceled org keeps every
  // feature until someone manually downgrades `tier`.
  it('denies when the subscription is canceled, despite a sufficient tier', () => {
    const d = decideEntitlement(
      snapshot({ subscriptionStatus: 'canceled', tier: 'enterprise' }),
      DRIVER_CHAT,
      NOW
    )
    expect(d.allowed).toBe(false)
    if (d.allowed) throw new Error('unreachable')
    expect(d.reason).toBe('SUBSCRIPTION_CANCELED')
  })

  it('denies when the subscription is suspended', () => {
    const d = decideEntitlement(snapshot({ subscriptionStatus: 'suspended' }), DRIVER_CHAT, NOW)
    expect(d.allowed).toBe(false)
  })

  // has_feature() ignores trial_ends_at: an expired trial keeps everything.
  it('denies once the trial has expired with no grace period', () => {
    const d = decideEntitlement(
      snapshot({ subscriptionStatus: 'trialing', trialEndsAt: YESTERDAY }),
      DRIVER_CHAT,
      NOW
    )
    expect(d.allowed).toBe(false)
    if (d.allowed) throw new Error('unreachable')
    expect(d.reason).toBe('TRIAL_EXPIRED')
  })

  it('allows during an unexpired trial', () => {
    const d = decideEntitlement(
      snapshot({ subscriptionStatus: 'trialing', trialEndsAt: TOMORROW }),
      DRIVER_CHAT,
      NOW
    )
    expect(d.allowed).toBe(true)
    if (!d.allowed) throw new Error('unreachable')
    expect(d.reason).toBe('WITHIN_TRIAL')
  })

  // grace_period_until is written by the admin UI and read by nothing today.
  it('allows an expired trial that is still inside its grace period', () => {
    const d = decideEntitlement(
      snapshot({ subscriptionStatus: 'trialing', trialEndsAt: YESTERDAY, gracePeriodUntil: TOMORROW }),
      DRIVER_CHAT,
      NOW
    )
    expect(d.allowed).toBe(true)
    if (!d.allowed) throw new Error('unreachable')
    expect(d.reason).toBe('WITHIN_GRACE_PERIOD')
  })
})

describe('past_due is carried, not cut off immediately', () => {
  // A bounced renewal retries for days. Killing access instantly is worse for
  // both parties than carrying the account until an operator says otherwise.
  it('still allows when past_due and no grace deadline has been set', () => {
    expect(decideEntitlement(snapshot({ subscriptionStatus: 'past_due' }), DRIVER_CHAT, NOW).allowed).toBe(true)
  })

  it('denies once the past_due grace period has elapsed', () => {
    const d = decideEntitlement(
      snapshot({ subscriptionStatus: 'past_due', gracePeriodUntil: YESTERDAY }),
      DRIVER_CHAT,
      NOW
    )
    expect(d.allowed).toBe(false)
    if (d.allowed) throw new Error('unreachable')
    expect(d.reason).toBe('PAST_DUE_GRACE_EXPIRED')
  })
})

describe('capabilities retained while delinquent', () => {
  it('keeps invoicing available to a canceled org so they can still settle up', () => {
    const d = decideEntitlement(snapshot({ subscriptionStatus: 'canceled' }), INVOICING, NOW)
    expect(d.allowed).toBe(true)
    if (!d.allowed) throw new Error('unreachable')
    expect(d.reason).toBe('RETAINED_WHILE_DELINQUENT')
  })

  it('does not extend that retention to ordinary capabilities', () => {
    expect(decideEntitlement(snapshot({ subscriptionStatus: 'canceled' }), DRIVER_CHAT, NOW).allowed).toBe(false)
  })
})

describe('per-org overrides', () => {
  it('a deny override beats a sufficient tier', () => {
    const d = decideEntitlement(
      snapshot({
        overrides: [{ capability: DRIVER_CHAT, effect: 'deny', expiresAt: null, reason: 'abuse' }],
      }),
      DRIVER_CHAT,
      NOW
    )
    expect(d.allowed).toBe(false)
    if (d.allowed) throw new Error('unreachable')
    expect(d.reason).toBe('DENIED_BY_OVERRIDE')
  })

  it('a grant override beats an insufficient tier', () => {
    const d = decideEntitlement(
      snapshot({
        tier: 'starter',
        overrides: [{ capability: DRIVER_CHAT, effect: 'grant', expiresAt: TOMORROW, reason: 'pilot' }],
      }),
      DRIVER_CHAT,
      NOW
    )
    expect(d.allowed).toBe(true)
  })

  it('ignores an expired override', () => {
    const d = decideEntitlement(
      snapshot({
        tier: 'starter',
        overrides: [{ capability: DRIVER_CHAT, effect: 'grant', expiresAt: YESTERDAY, reason: 'expired pilot' }],
      }),
      DRIVER_CHAT,
      NOW
    )
    expect(d.allowed).toBe(false)
  })

  it('a deny override still cannot be escaped by delinquency retention', () => {
    // Ordering check: deny is evaluated BEFORE the retained-capability escape
    // hatch, so an abusive org cannot keep invoicing by going past_due.
    const d = decideEntitlement(
      snapshot({
        subscriptionStatus: 'canceled',
        overrides: [{ capability: INVOICING, effect: 'deny', expiresAt: null, reason: 'fraud' }],
      }),
      INVOICING,
      NOW
    )
    expect(d.allowed).toBe(false)
  })
})

describe('fail-closed behaviour', () => {
  it('denies an unregistered capability key rather than defaulting to allow', () => {
    const d = decideEntitlement(snapshot(), asCapabilityKey('typo_capability'), NOW)
    expect(d.allowed).toBe(false)
    if (d.allowed) throw new Error('unreachable')
    expect(d.reason).toBe('UNKNOWN_CAPABILITY')
  })

  it('denies non-carrier organizations, which hold no subscription', () => {
    // Customer/shipper orgs and the ShipmentX platform org have no
    // carrier_details row — the case where has_feature() returns NULL.
    const d = decideEntitlement(snapshot({ isCarrierOrg: false }), DRIVER_CHAT, NOW)
    expect(d.allowed).toBe(false)
    if (d.allowed) throw new Error('unreachable')
    expect(d.reason).toBe('NOT_A_CARRIER_ORG')
  })

  it('a disabled platform flag overrides every commercial grant', () => {
    const d = decideEntitlement(
      snapshot({
        tier: 'enterprise',
        platformFlags: [{ key: DRIVER_CHAT, enabled: false }],
      }),
      DRIVER_CHAT,
      NOW
    )
    expect(d.allowed).toBe(false)
    if (d.allowed) throw new Error('unreachable')
    expect(d.reason).toBe('DISABLED_BY_PLATFORM_FLAG')
  })
})

describe('usage limits', () => {
  it('allows usage below the hard cap', () => {
    expect(checkUsageLimit(snapshot(), 'trucks', 9).withinLimit).toBe(true)
  })

  it('blocks at the hard cap', () => {
    expect(checkUsageLimit(snapshot(), 'trucks', 10).withinLimit).toBe(false)
  })

  it('treats a missing hard cap as billable overage, not a block', () => {
    const s = snapshot({ limits: [{ key: 'trucks', included: 3, hardCap: null }] })
    expect(checkUsageLimit(s, 'trucks', 9999).withinLimit).toBe(true)
  })
})

describe('projection for the frontend', () => {
  it('reports every capability with a reason, not just booleans', () => {
    const projected = projectAllCapabilities(snapshot({ tier: 'starter' }), NOW)
    const chat = projected.find((p) => p.key === DRIVER_CHAT)
    expect(chat).toBeDefined()
    expect(chat!.allowed).toBe(false)
    // The reason is what lets the UI render "Upgrade to Growth" instead of
    // silently hiding the feature.
    expect(chat!.reason).toBe('TIER_TOO_LOW')
  })

  it('covers all known capabilities', () => {
    expect(projectAllCapabilities(snapshot(), NOW)).toHaveLength(2)
  })
})
