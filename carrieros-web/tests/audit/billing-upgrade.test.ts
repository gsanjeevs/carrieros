// Audit probes: can a carrier really pay to upgrade? Read-only w.r.t. production code.
// Uses throwaway orgs only. Assertions document CURRENT behaviour; tests titled
// "GAP:" pass when the gap EXISTS (i.e. they are evidence, flip when fixed).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch, type TestOrg } from '../helpers'

const admin = adminClient()
let orgA: TestOrg, orgB: TestOrg
let owner: any, otherOwner: any, dispatcher: any, driver: any, finance: any
let ownerS: any, otherS: any, dispS: any, drvS: any, finS: any

const post = (tok: string, body: unknown, raw = false) =>
  apiFetch('/api/billing/change-tier', tok, { method: 'POST', body: raw ? (body as string) : JSON.stringify(body) })
const details = async (id: number) =>
  (await admin.from('carrier_details').select('*').eq('org_id', id).single()).data as any

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  orgB = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  owner = await createTestUser(admin, orgA.orgId, 'owner')
  dispatcher = await createTestUser(admin, orgA.orgId, 'dispatcher')
  driver = await createTestUser(admin, orgA.orgId, 'driver')
  finance = await createTestUser(admin, orgA.orgId, 'finance')
  otherOwner = await createTestUser(admin, orgB.orgId, 'owner')
  ownerS = await signInAs(owner); dispS = await signInAs(dispatcher); drvS = await signInAs(driver)
  finS = await signInAs(finance); otherS = await signInAs(otherOwner)
})
afterAll(async () => { await cleanupTestOrg(admin, orgA.orgId); await cleanupTestOrg(admin, orgB.orgId) })

describe('authorization of change-tier', () => {
  it('unauthenticated -> 401', async () => {
    const r = await fetch(`${process.env.TEST_APP_URL ?? 'http://localhost:3000'}/api/billing/change-tier`, { method: 'POST', body: '{"tier":"pro"}', headers: { 'Content-Type': 'application/json' } })
    expect(r.status).toBe(401)
  })
  it.each([['dispatcher'], ['driver'], ['finance']])('%s -> 403 and tier unchanged', async (who) => {
    const tok = { dispatcher: dispS, driver: drvS, finance: finS }[who as string].accessToken
    const r = await post(tok, { tier: 'enterprise' })
    expect(r.status).toBe(403)
    expect((await details(orgA.orgId)).tier).toBe('starter')
  })
  it('another tenant owner can only affect their own org (no org_id param honoured)', async () => {
    const r = await apiFetch('/api/billing/change-tier', otherS.accessToken, { method: 'POST', body: JSON.stringify({ tier: 'growth', org_id: orgA.orgId }) })
    expect(r.status).toBe(200)
    expect((await details(orgA.orgId)).tier).toBe('starter')
    expect((await details(orgB.orgId)).tier).toBe('growth')
    await admin.from('carrier_details').update({ tier: 'starter' }).eq('org_id', orgB.orgId)
  })
})

describe('validation', () => {
  it.each([[{}], [{ tier: 5 }], [{ tier: null }], [{ tier: '' }], [{ tier: 'PRO' }], [{ tier: "pro' or 1=1" }], [{ tier: ['pro'] }]])('rejects %j', async (b) => {
    const r = await post(ownerS.accessToken, b)
    expect(r.status).toBe(400)
  })
  it('malformed JSON body -> should be 4xx, not 500', async () => {
    const r = await post(ownerS.accessToken, '{not json', true)
    console.log('malformed JSON status =', r.status)
    expect(r.status).toBeLessThan(500) // fails if route lacks try/catch around request.json()
  })
})

describe('GAP: tier change is a free column flip', () => {
  it('owner with NO payment method, trialing, jumps to enterprise for free and nothing is recorded', async () => {
    const before = await details(orgA.orgId)
    expect(before.stripe_customer_id).toBeNull()
    const r = await post(ownerS.accessToken, { tier: 'enterprise' })
    expect(r.status).toBe(200)
    const after = await details(orgA.orgId)
    expect(after.tier).toBe('enterprise')
    expect(after.billing_status).toBe('trialing') // no status transition
    const { data: ev } = await admin.from('billing_events').select('id').eq('org_id', orgA.orgId)
    expect(ev).toHaveLength(0) // no billing event
    const { data: au } = await admin.from('audit_events').select('*').eq('org_id', orgA.orgId).limit(20)
    console.log('audit_events rows after tier change:', au?.length, JSON.stringify(au?.map((a: any) => a.action ?? a.event_type)))
  })
  it('replay of same request is 200 again (no idempotency key, no versioning) and honours no Idempotency-Key', async () => {
    const a = await apiFetch('/api/billing/change-tier', ownerS.accessToken, { method: 'POST', headers: { 'Idempotency-Key': 'k1' }, body: '{"tier":"enterprise"}' })
    const b = await apiFetch('/api/billing/change-tier', ownerS.accessToken, { method: 'POST', headers: { 'Idempotency-Key': 'k1' }, body: '{"tier":"enterprise"}' })
    expect([a.status, b.status]).toEqual([200, 200])
  })
  it('concurrent conflicting changes: last write wins, no conflict detection', async () => {
    const rs = await Promise.all(['starter', 'pro', 'growth', 'enterprise'].map((t) => post(ownerS.accessToken, { tier: t })))
    expect(rs.every((r) => r.status === 200)).toBe(true)
  })
})

describe('GAP: owner can bypass the API and write billing columns directly via RLS', () => {
  it('owner PATCHes carrier_details.tier directly with own JWT', async () => {
    await admin.from('carrier_details').update({ tier: 'starter' }).eq('org_id', orgA.orgId)
    const { data, error } = await ownerS.client.from('carrier_details').update({ tier: 'pro' }).eq('org_id', orgA.orgId).select('tier')
    console.log('direct tier write:', error?.message, JSON.stringify(data))
    expect((await details(orgA.orgId)).tier).toBe('pro')
  })
  it('owner can forge billing_status/trial/grace/stripe ids/card directly', async () => {
    const { error } = await ownerS.client.from('carrier_details').update({
      billing_status: 'active', trial_ends_at: '2099-01-01T00:00:00Z', grace_period_until: null,
      stripe_customer_id: 'cus_FORGED', card_brand: 'amex', card_last4: '0000',
    }).eq('org_id', orgA.orgId)
    console.log('direct forge error:', error?.message)
    const d = await details(orgA.orgId)
    expect(d.billing_status).toBe('active')
    expect(d.trial_ends_at).toMatch(/2099/)
    expect(d.stripe_customer_id).toBe('cus_FORGED')
  })
  it('a dispatcher cannot do the same (RLS holds)', async () => {
    await dispS.client.from('carrier_details').update({ tier: 'enterprise' }).eq('org_id', orgA.orgId)
    expect((await details(orgA.orgId)).tier).toBe('pro')
  })
  it('owner cannot touch another org row', async () => {
    await otherS.client.from('carrier_details').update({ tier: 'enterprise' }).eq('org_id', orgA.orgId)
    expect((await details(orgA.orgId)).tier).toBe('pro')
  })
})

describe('entitlements after tier change; delinquency and downgrade', () => {
  const keys = async (s: any) => ((await s.client.rpc('get_my_entitlements')).data ?? []).map((r: any) => r.key).sort()
  it('change-tier takes effect in get_my_entitlements immediately (up and down)', async () => {
    await post(ownerS.accessToken, { tier: 'starter' })
    const low = await keys(ownerS)
    await post(ownerS.accessToken, { tier: 'enterprise' })
    const high = await keys(ownerS)
    console.log('starter keys', low.length, 'enterprise keys', high.length)
    expect(high.length).toBeGreaterThan(low.length)
    await post(ownerS.accessToken, { tier: 'starter' })
    expect(await keys(ownerS)).toEqual(low)
  })
  it('GAP: past_due / canceled / expired trial / lapsed grace keep full paid entitlements', async () => {
    await admin.from('carrier_details').update({ tier: 'enterprise' }).eq('org_id', orgA.orgId)
    const full = await keys(ownerS)
    for (const patch of [
      { billing_status: 'past_due' }, { billing_status: 'canceled' },
      { billing_status: 'trialing', trial_ends_at: '2020-01-01T00:00:00Z' },
      { billing_status: 'past_due', grace_period_until: '2020-01-01T00:00:00Z' },
    ]) {
      await admin.from('carrier_details').update(patch as any).eq('org_id', orgA.orgId)
      expect(await keys(ownerS)).toEqual(full)
    }
  })
  it('GAP: downgrade with fleet above new tier included_trucks is accepted (no usage check)', async () => {
    await admin.from('carrier_details').update({ tier: 'enterprise', billing_status: 'active', trial_ends_at: null }).eq('org_id', orgA.orgId)
    for (let i = 0; i < 3; i++) {
      await admin.from('vehicles').insert({ carrier_org_id: orgA.orgId, unit_number: `AUD-${i}`, is_active: true } as any)
    }
    const r = await post(ownerS.accessToken, { tier: 'starter' }) // starter includes 1 truck
    console.log('downgrade w/ 3 trucks -> status', r.status)
    expect(r.status).toBe(200)
    await admin.from('vehicles').delete().eq('carrier_org_id', orgA.orgId)
  })
})
