// AUDIT PROBE (read-only w.r.t. production code). Each `it` asserts the DESIRED secure behaviour, so a RED
// test == an enforcement gap. Throwaway orgs only; real DB + app at TEST_APP_URL.
// Part 1: does the STARTER tier actually get blocked from gated features (a) via the app's API routes and
// (b) when the caller skips the app and talks straight to PostgREST/RPC with their own JWT (RLS is the only guard).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch, type TestOrg } from '../helpers'

const admin = adminClient()
let org: TestOrg
let owner: Awaited<ReturnType<typeof signInAs>>
let driver: Awaited<ReturnType<typeof signInAs>>
let driverId: number
let loadId: number
let vehicleTypeId: number
const post = (t: string, path: string, body: unknown, method = 'POST') => apiFetch(path, t, { method, body: JSON.stringify(body) })

beforeAll(async () => {
  org = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  const o = await createTestUser(admin, org.orgId, 'owner')
  const d = await createTestUser(admin, org.orgId, 'driver')
  owner = await signInAs(o)
  driver = await signInAs(d)
  driverId = Number((await admin.from('drivers').insert({ carrier_org_id: org.orgId, profile_id: d.userId }).select('id').single()).data!.id)
  loadId = Number((await admin.from('loads').insert({ carrier_org_id: org.orgId, load_number: `AUD-${Date.now()}`, status: 'in_transit', driver_id: driverId }).select('id').single()).data!.id)
  vehicleTypeId = Number((await admin.from('vehicle_types').select('id').limit(1).single()).data!.id)
})
afterAll(async () => {
  await admin.from('idempotency_keys').delete().eq('org_id', org.orgId)
  await admin.from('load_expenses').delete().eq('carrier_org_id', org.orgId)
  await admin.from('driver_messages').delete().eq('carrier_org_id', org.orgId)
  await admin.from('vehicles').delete().eq('carrier_org_id', org.orgId)
  await cleanupTestOrg(admin, org.orgId)
})

describe('sanity: starter org really has no gated entitlements', () => {
  it('has_feature is false and get_my_entitlements is empty', async () => {
    expect((await owner.client.rpc('has_feature', { feature_key: 'driver_chat' })).data).toBe(false)
    expect((await owner.client.rpc('get_my_entitlements')).data ?? []).toEqual([])
  })
})

describe('API routes deny starter (server-side, read-by-eye says enforced)', () => {
  it('POST /api/driver-messages -> 403 TIER_UPGRADE_REQUIRED', async () => {
    const r = await post(driver.accessToken, '/api/driver-messages', { load_id: loadId, body: 'hi' })
    expect(r.status).toBe(403)
    expect(JSON.stringify(await r.json())).toMatch(/TIER_UPGRADE_REQUIRED/)
  })
  it('POST /api/settlements/run -> 403', async () => {
    const r = await post(owner.accessToken, '/api/settlements/run', { driver_id: driverId, period_start: '2026-01-01', period_end: '2026-01-31' })
    expect(r.status).toBe(403)
  })
  it('POST /api/settlements/{id}/send-ach -> 403', async () => {
    expect((await post(owner.accessToken, '/api/settlements/1/send-ach', {})).status).toBe(403)
  })
  it('POST /api/team/invite role=dispatcher and role=finance -> 403', async () => {
    for (const role of ['dispatcher', 'finance'])
      expect((await post(owner.accessToken, '/api/team/invite', { email: `aud_${role}_${Date.now()}@carrieros-test.dev`, role })).status).toBe(403)
  })
  it('POST /api/v1/loads/{id}/ifta-crossings (driver) -> 403', async () => {
    const r = await apiFetch(`/api/v1/loads/${loadId}/ifta-crossings`, driver.accessToken, {
      method: 'POST', headers: { 'Idempotency-Key': `aud-${Date.now()}` },
      body: JSON.stringify({ state: 'nv', crossed_at: new Date(Date.now() - 60000).toISOString(), latitude: 39.5, longitude: -119.8 }),
    })
    expect([402, 403]).toContain(r.status) // v1 maps ENTITLEMENT_REQUIRED to 402
  })
  it('POST /api/v1/loads/{id}/ifta-crossings/manual (driver) -> 403', async () => {
    const r = await apiFetch(`/api/v1/loads/${loadId}/ifta-crossings/manual`, driver.accessToken, {
      method: 'PUT', headers: { 'Idempotency-Key': `aud-m-${Date.now()}` }, body: JSON.stringify({ rows: [{ state: 'nv', miles: 10 }] }),
    })
    expect([402, 403]).toContain(r.status)
  })
})

describe('BYPASS: direct PostgREST/RPC with the caller\'s own JWT (RLS/RPC is the only guard)', () => {
  it('driver_chat: driver can INSERT into driver_messages directly', async () => {
    const { error } = await driver.client.from('driver_messages').insert({ carrier_org_id: org.orgId, load_id: loadId, sender_id: (await driver.client.auth.getUser()).data.user?.id ?? '', body: 'bypass' } as never)
    expect(error, 'direct insert should be denied on starter').not.toBeNull()
  })
  it('driver_chat: owner can INSERT into driver_messages directly', async () => {
    const uid = (await owner.client.auth.getUser()).data.user?.id
    const { error } = await owner.client.from('driver_messages').insert({ carrier_org_id: org.orgId, load_id: loadId, sender_id: uid, body: 'bypass2' } as never)
    expect(error).not.toBeNull()
  })
  it('load_expenses: owner can INSERT (Growth feature; no API exists at all)', async () => {
    const { error } = await owner.client.from('load_expenses').insert({ carrier_org_id: org.orgId, load_id: loadId, expense_type: 'toll', amount: 5 })
    expect(error).not.toBeNull()
  })
  it('driver_settlements: owner can INSERT directly', async () => {
    const { error } = await owner.client.from('driver_settlements').insert({ carrier_org_id: org.orgId, driver_id: driverId, pay_method: 'flat_per_load', gross_revenue: 1, net_pay: 1 } as never)
    expect(error).not.toBeNull()
  })
  it('ifta_mileage_log: driver can INSERT ifta_state_crossings directly', async () => {
    const { error } = await driver.client.from('ifta_state_crossings').insert({ carrier_org_id: org.orgId, driver_id: driverId, load_id: loadId, state: 'NV', crossed_at: new Date().toISOString(), source: 'gps' } as never)
    expect(error).not.toBeNull()
  })
  it('ifta_tax_hub (Pro): get_ifta_tax_summary / get_ifta_quarterly_summary return nothing / error on starter', async () => {
    await admin.from('ifta_state_crossings').insert({ carrier_org_id: org.orgId, driver_id: driverId, load_id: loadId, state: 'NV', crossed_at: '2026-02-01T00:00:00Z', odometer_est: 100, source: 'gps' } as never)
    const r = await owner.client.rpc('get_ifta_quarterly_summary', { p_carrier_org_id: org.orgId, p_quarter: '2026-Q1' })
    expect(r.data ?? [], 'starter got IFTA quarterly numbers').toEqual([])
  })
  it('customer_health_score (Growth): RPC is callable on starter', async () => {
    const r = await owner.client.rpc('get_customer_health_score', { customer_org_id: org.orgId })
    expect(r.error, 'RPC answered without an entitlement check').not.toBeNull()
  })
  it('dispatcher_finance_roles: owner can promote an existing member to dispatcher by UPDATE profiles directly', async () => {
    const d = await createTestUser(admin, org.orgId, 'dispatcher') // just a 2nd member to re-role
    await admin.from('profiles').update({ role: 'driver' }).eq('id', d.userId)
    const { data } = await owner.client.from('profiles').update({ role: 'dispatcher' }).eq('id', d.userId).select('role')
    expect(data ?? [], 'direct role write should be blocked').toEqual([])
  })
  it('exceptions inbox: get_exceptions() returns the full list on starter (only the UI truncates)', async () => {
    const r = await owner.client.rpc('get_exceptions')
    // informational: documented as intentional ("detection stays visible at every tier"); not asserted red/green
    expect(r.error).toBeNull()
  })
})

describe('usage limits (tiers.included_trucks)', () => {
  it('starter includes 1 truck: a 2nd/3rd POST /api/vehicles is refused or flagged', async () => {
    const codes: number[] = []
    for (let i = 0; i < 3; i++)
      codes.push((await post(owner.accessToken, '/api/vehicles', { nickname: `Aud${i}`, vehicle_type_id: vehicleTypeId })).status)
    expect(codes.slice(1).some((c) => c >= 400), `statuses ${codes}: no cap and no overage signal`).toBe(true)
  })
})
