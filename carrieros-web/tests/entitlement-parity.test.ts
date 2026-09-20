// tests/entitlement-parity.test.ts — the SQL decision (entitlement_decision, migration 0021) and the pure TypeScript
// decision (server/domain/entitlement/model.ts) are the same rules written twice: SQL because RLS/RPCs can only
// call SQL, TypeScript because it is what the domain tests pin. This runs identical scenarios through both and
// fails if they ever disagree, so neither can drift on its own.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, createTestOrg, cleanupTestOrg } from './helpers'
import {
  asCapabilityKey, decideEntitlement, type EntitlementSnapshot, type SubscriptionStatus, type TierCode,
} from '@/server/domain/entitlement/model'
import { asOrgId } from '@/server/domain/shared/identity'

const admin = adminClient()
const DAY = 86_400_000
const FEATURE = 'zz_parity_feature'    // growth+
const RETAINED = 'zz_parity_retained'  // growth+, survives delinquency
let carrierOrg: number
let customerOrg: number

beforeAll(async () => {
  await admin.from('features').delete().like('key', 'zz_parity%') // leftovers from an aborted run
  const { error: featErr } = await admin.from('features').insert([
    { key: FEATURE, label: 'Parity', min_tier: 'growth', display_order: 900, retained_when_delinquent: false },
    { key: RETAINED, label: 'Parity retained', min_tier: 'growth', display_order: 901, retained_when_delinquent: true },
  ])
  if (featErr) throw new Error(`seed features: ${featErr.message}`)
  carrierOrg = (await createTestOrg(admin, 'carrier')).orgId
  customerOrg = (await createTestOrg(admin, 'customer')).orgId
})
afterAll(async () => {
  await admin.from('org_flag_overrides').delete().eq('org_id', carrierOrg)
  await admin.from('platform_flags').delete().like('flag_key', 'zz_parity%')
  await admin.from('org_feature_overrides').delete().eq('org_id', carrierOrg)
  await admin.from('features').delete().like('key', 'zz_parity%')
  await cleanupTestOrg(admin, carrierOrg)
  await cleanupTestOrg(admin, customerOrg)
})

interface Scenario {
  name: string
  key?: string
  tier: TierCode
  status?: SubscriptionStatus
  trialDays?: number | null   // relative to now; negative = expired
  graceDays?: number | null
  override?: { effect: 'grant' | 'deny'; expiresInDays: number | null }
  flag?: { defaultEnabled: boolean; orgEnabled?: boolean }
  org?: 'customer'
  expect: { allowed: boolean; reason: string }
}

const scenarios: Scenario[] = [
  { name: 'growth, active', tier: 'growth', status: 'active', expect: { allowed: true, reason: 'INCLUDED_IN_TIER' } },
  { name: 'starter, active', tier: 'starter', status: 'active', expect: { allowed: false, reason: 'TIER_TOO_LOW' } },
  { name: 'growth in trial', tier: 'growth', status: 'trialing', trialDays: 30, expect: { allowed: true, reason: 'WITHIN_TRIAL' } },
  { name: 'growth, trial expired, no grace', tier: 'growth', status: 'trialing', trialDays: -1, expect: { allowed: false, reason: 'TRIAL_EXPIRED' } },
  { name: 'growth, trial expired, grace running', tier: 'growth', status: 'trialing', trialDays: -1, graceDays: 3, expect: { allowed: true, reason: 'WITHIN_GRACE_PERIOD' } },
  { name: 'growth, canceled', tier: 'growth', status: 'canceled', expect: { allowed: false, reason: 'SUBSCRIPTION_CANCELED' } },
  { name: 'growth, past_due with no grace set', tier: 'growth', status: 'past_due', expect: { allowed: true, reason: 'WITHIN_GRACE_PERIOD' } },
  { name: 'growth, past_due, grace ended', tier: 'growth', status: 'past_due', graceDays: -1, expect: { allowed: false, reason: 'PAST_DUE_GRACE_EXPIRED' } },
  { name: 'starter + grant override', tier: 'starter', status: 'active', override: { effect: 'grant', expiresInDays: null }, expect: { allowed: true, reason: 'GRANTED_BY_OVERRIDE' } },
  { name: 'starter + expired grant', tier: 'starter', status: 'active', override: { effect: 'grant', expiresInDays: -1 }, expect: { allowed: false, reason: 'TIER_TOO_LOW' } },
  { name: 'growth + deny override', tier: 'growth', status: 'active', override: { effect: 'deny', expiresInDays: null }, expect: { allowed: false, reason: 'DENIED_BY_OVERRIDE' } },
  { name: 'growth + expired deny', tier: 'growth', status: 'active', override: { effect: 'deny', expiresInDays: -1 }, expect: { allowed: true, reason: 'INCLUDED_IN_TIER' } },
  { name: 'canceled beats a grant', tier: 'growth', status: 'canceled', override: { effect: 'grant', expiresInDays: null }, expect: { allowed: false, reason: 'SUBSCRIPTION_CANCELED' } },
  { name: 'canceled but retained feature', key: RETAINED, tier: 'growth', status: 'canceled', expect: { allowed: true, reason: 'RETAINED_WHILE_DELINQUENT' } },
  { name: 'platform flag off by default', tier: 'growth', status: 'active', flag: { defaultEnabled: false }, expect: { allowed: false, reason: 'DISABLED_BY_PLATFORM_FLAG' } },
  { name: 'platform flag off, enabled for this org', tier: 'growth', status: 'active', flag: { defaultEnabled: false, orgEnabled: true }, expect: { allowed: true, reason: 'INCLUDED_IN_TIER' } },
  { name: 'platform flag on, disabled for this org', tier: 'growth', status: 'active', flag: { defaultEnabled: true, orgEnabled: false }, expect: { allowed: false, reason: 'DISABLED_BY_PLATFORM_FLAG' } },
  { name: 'unknown capability', key: 'zz_parity_missing', tier: 'enterprise', status: 'active', expect: { allowed: false, reason: 'UNKNOWN_CAPABILITY' } },
  { name: 'customer org has no subscription', tier: 'enterprise', org: 'customer', expect: { allowed: false, reason: 'NOT_A_CARRIER_ORG' } },
]

describe.each(scenarios)('$name', (s) => {
  it('SQL and TypeScript decide identically, and both match the documented outcome', async () => {
    const key = s.key ?? FEATURE
    const now = Date.now()
    const at = (days: number | null | undefined) => (days === null || days === undefined ? null : new Date(now + days * DAY))
    const status = s.status ?? 'active'

    // Arrange the org row(s) in the database.
    await admin.from('org_feature_overrides').delete().eq('org_id', carrierOrg)
    await admin.from('org_flag_overrides').delete().eq('org_id', carrierOrg)
    await admin.from('platform_flags').delete().like('flag_key', 'zz_parity%')
    await admin.from('carrier_details').update({
      tier: s.tier, billing_status: status,
      trial_ends_at: at(s.trialDays ?? (status === 'trialing' ? 30 : null))?.toISOString() ?? null,
      grace_period_until: at(s.graceDays)?.toISOString() ?? null,
    }).eq('org_id', carrierOrg)
    if (s.override) {
      await admin.from('org_feature_overrides').insert({
        org_id: carrierOrg, feature_key: key, effect: s.override.effect, reason: 'parity test',
        expires_at: at(s.override.expiresInDays)?.toISOString() ?? null,
      })
    }
    if (s.flag) {
      await admin.from('platform_flags').insert({ flag_key: key, description: 'parity', default_enabled: s.flag.defaultEnabled })
      if (s.flag.orgEnabled !== undefined) await admin.from('org_flag_overrides').insert({ org_id: carrierOrg, flag_key: key, enabled: s.flag.orgEnabled })
    }
    const orgId = s.org === 'customer' ? customerOrg : carrierOrg

    // SQL decision.
    const { data, error } = await admin.rpc('entitlement_decision', { p_org_id: orgId, p_key: key })
    expect(error).toBeNull()
    const sql = (data as { allowed: boolean; reason: string }[])[0]

    // TypeScript decision over the same facts.
    const cap = { key: asCapabilityKey(FEATURE), minTier: 'growth' as TierCode }
    const snapshot: EntitlementSnapshot = {
      orgId: asOrgId(orgId),
      subscriptionStatus: status,
      tier: s.tier,
      trialEndsAt: at(s.trialDays ?? (status === 'trialing' ? 30 : null)),
      gracePeriodUntil: at(s.graceDays),
      capabilities: [cap, { key: asCapabilityKey(RETAINED), minTier: 'growth', retainedWhenDelinquent: true }],
      limits: [],
      overrides: s.override ? [{ capability: asCapabilityKey(key), effect: s.override.effect, expiresAt: at(s.override.expiresInDays), reason: 'parity test' }] : [],
      platformFlags: s.flag ? [{ key, enabled: s.flag.orgEnabled ?? s.flag.defaultEnabled }] : [],
      isCarrierOrg: s.org !== 'customer',
    }
    const ts = decideEntitlement(snapshot, asCapabilityKey(key), new Date(now))

    expect({ allowed: sql.allowed, reason: sql.reason }).toEqual({ allowed: ts.allowed, reason: ts.reason })
    expect({ allowed: sql.allowed, reason: sql.reason }).toEqual(s.expect)
  })
})
