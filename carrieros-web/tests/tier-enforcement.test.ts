// tests/tier-enforcement.test.ts — tier and subscription standing are enforced by the DATABASE, not just by API routes.
// Every case here went through a real user session against PostgREST/RLS, i.e. what a modified client can do.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg } from './helpers'

const admin = adminClient()
let starter: number, growth: number
let owner: { client: Awaited<ReturnType<typeof signInAs>>['client'] }, growthOwner: typeof owner
let starterLoad: number, growthLoad: number

const setStanding = (org: number, patch: { billing_status?: string; trial_ends_at?: string | null; grace_period_until?: string | null }) => admin.from('carrier_details').update(patch).eq('org_id', org)
const makeLoad = async (org: number) => Number((await admin.from('loads').insert({ carrier_org_id: org, load_number: `TE-${org}-${Date.now()}`, status: 'dispatched' }).select('id').single()).data!.id)

beforeAll(async () => {
  starter = (await createTestOrg(admin, 'carrier', { tier: 'starter' })).orgId
  growth = (await createTestOrg(admin, 'carrier', { tier: 'growth' })).orgId
  owner = await signInAs(await createTestUser(admin, starter, 'owner'))
  growthOwner = await signInAs(await createTestUser(admin, growth, 'owner'))
  starterLoad = await makeLoad(starter)
  growthLoad = await makeLoad(growth)
}, 60_000)
afterAll(async () => {
  await admin.from('load_expenses').delete().in('carrier_org_id', [starter, growth])
  await admin.from('driver_messages').delete().in('carrier_org_id', [starter, growth])
  for (const o of [starter, growth]) await cleanupTestOrg(admin, o)
})

const expense = (org: number, load: number) => ({ carrier_org_id: org, load_id: load, expense_type: 'fuel', amount: 10 })

describe('gated writes are refused below the tier, straight through PostgREST', () => {
  it('load_expenses (Growth+): refused on Starter, accepted on Growth', async () => {
    expect((await owner.client.from('load_expenses').insert(expense(starter, starterLoad))).error).not.toBeNull()
    expect((await growthOwner.client.from('load_expenses').insert(expense(growth, growthLoad))).error).toBeNull()
  })

  it('driver chat (Growth+): an owner cannot write a message on Starter', async () => {
    const { data: u } = await admin.from('profiles').select('id').eq('org_id', starter).limit(1).single()
    const msg = (org: number, load: number, sender: string) => ({ carrier_org_id: org, load_id: load, sender_id: sender, body: 'x', original_language: 'en' })
    expect((await owner.client.from('driver_messages').insert(msg(starter, starterLoad, u!.id))).error).not.toBeNull()
    const { data: g } = await admin.from('profiles').select('id').eq('org_id', growth).limit(1).single()
    expect((await growthOwner.client.from('driver_messages').insert(msg(growth, growthLoad, g!.id))).error).toBeNull()
  })

  it('gated read RPCs answer nothing below their tier', async () => {
    const year = new Date().getFullYear()
    const q = await owner.client.rpc('get_ifta_quarterly_summary', { p_carrier_org_id: starter, p_quarter: `${year}-Q1` })
    expect(q.data ?? []).toEqual([])
    const t = await owner.client.rpc('get_ifta_tax_summary', { p_carrier_org_id: starter, p_quarter: `${year}-Q1` })
    expect(t.data ?? []).toEqual([])
    const h = await owner.client.rpc('get_customer_health_score', { customer_org_id: starter })
    expect(h.data).toBeNull()
  })

  it('a starter driver cannot replace IFTA crossings (402), and never gets past the feature check', async () => {
    const driverUser = await createTestUser(admin, starter, 'driver')
    const { data: d } = await admin.from('drivers').insert({ carrier_org_id: starter, profile_id: driverUser.userId }).select('id').single()
    const load = await makeLoad(starter)
    await admin.from('loads').update({ driver_id: d!.id }).eq('id', load)
    const driver = await signInAs(driverUser)
    const { error } = await driver.client.rpc('replace_ifta_crossings_with_manual', { p_load_id: load, p_rows: [{ state: 'NV', miles: 5 }] })
    expect(error?.code).toBe('PT402')
    await admin.from('drivers').delete().eq('id', d!.id)
  })
})

describe('subscription standing reaches the same gates', () => {
  it('a canceled subscription loses gated features; reactivating restores them', async () => {
    await setStanding(growth, { billing_status: 'canceled' })
    expect((await growthOwner.client.rpc('has_feature', { feature_key: 'driver_chat' })).data).toBe(false)
    // (ignore zz_ features that other test files register concurrently)
    const keys = ((await growthOwner.client.rpc('get_my_entitlements')).data ?? []) as { key: string }[]
    expect(keys.filter((k) => !k.key.startsWith('zz_'))).toEqual([])
    expect((await growthOwner.client.from('load_expenses').insert(expense(growth, growthLoad))).error).not.toBeNull()
    // history stays readable
    expect(((await growthOwner.client.from('load_expenses').select('id')).data ?? []).length).toBeGreaterThan(0)

    await setStanding(growth, { billing_status: 'active' })
    expect((await growthOwner.client.rpc('has_feature', { feature_key: 'driver_chat' })).data).toBe(true)
  })

  it('an expired trial is denied until a grace period is set, and get_my_entitlement says why', async () => {
    await setStanding(growth, { billing_status: 'trialing', trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(), grace_period_until: null })
    const denied = (await growthOwner.client.rpc('get_my_entitlement', { p_key: 'driver_chat' })).data as { allowed: boolean; reason: string }[]
    expect(denied[0]).toEqual({ allowed: false, reason: 'TRIAL_EXPIRED' })
    await setStanding(growth, { grace_period_until: new Date(Date.now() + 86_400_000).toISOString() })
    expect(((await growthOwner.client.rpc('get_my_entitlement', { p_key: 'driver_chat' })).data as { allowed: boolean }[])[0].allowed).toBe(true)
    await setStanding(growth, { billing_status: 'active', trial_ends_at: null, grace_period_until: null })
  })

  it('has_feature is false, never null, for an unknown key', async () => {
    expect((await growthOwner.client.rpc('has_feature', { feature_key: 'no_such_feature' })).data).toBe(false)
  })
})

describe('the decision surface is not a way around tenancy', () => {
  it('entitlement_decision takes an org id, so clients cannot call it at all', async () => {
    expect((await growthOwner.client.rpc('entitlement_decision', { p_org_id: starter, p_key: 'driver_chat' })).error).not.toBeNull()
  })
  it('org_feature_overrides is invisible and unwritable to a carrier owner', async () => {
    await admin.from('org_feature_overrides').upsert({ org_id: starter, feature_key: 'driver_chat', effect: 'grant', reason: 'test' })
    expect((await owner.client.from('org_feature_overrides').select('*')).error).not.toBeNull()
    expect((await owner.client.from('org_feature_overrides').insert({ org_id: starter, feature_key: 'load_expenses', effect: 'grant', reason: 'self' })).error).not.toBeNull()
    await admin.from('org_feature_overrides').delete().eq('org_id', starter)
  })
  it('an admin grant override unlocks one feature without changing the tier', async () => {
    await admin.from('org_feature_overrides').upsert({ org_id: starter, feature_key: 'driver_chat', effect: 'grant', reason: 'pilot' })
    expect((await owner.client.rpc('has_feature', { feature_key: 'driver_chat' })).data).toBe(true)
    expect((await owner.client.rpc('has_feature', { feature_key: 'load_expenses' })).data).toBe(false)
    await admin.from('org_feature_overrides').delete().eq('org_id', starter)
    expect((await owner.client.rpc('has_feature', { feature_key: 'driver_chat' })).data).toBe(false)
  })
})
