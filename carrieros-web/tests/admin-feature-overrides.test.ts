// tests/admin-feature-overrides.test.ts — ShipmentX staff can grant/deny one feature for one carrier; nobody else can,
// and it takes effect on the carrier's next request without touching the tier.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg } from './helpers'

const APP = process.env.TEST_APP_URL ?? 'http://localhost:3000'
const admin = adminClient()
let platformOrg: number, carrier: number
let sxOwner: string, sxFinance: string, sxSupport: string, carrierOwnerToken: string
let carrierOwner: Awaited<ReturnType<typeof signInAs>>['client']

const call = (token: string, method: string, body: unknown) =>
  fetch(`${APP}/api/admin/orgs/${carrier}/feature-overrides`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeAll(async () => {
  platformOrg = (await createTestOrg(admin, 'carrier')).orgId
  await admin.from('organizations').update({ type: 'platform' }).eq('id', platformOrg)
  carrier = (await createTestOrg(admin, 'carrier', { tier: 'starter' })).orgId
  sxOwner = (await signInAs(await createTestUser(admin, platformOrg, 'sx_owner'))).accessToken
  sxFinance = (await signInAs(await createTestUser(admin, platformOrg, 'sx_finance'))).accessToken
  sxSupport = (await signInAs(await createTestUser(admin, platformOrg, 'sx_support'))).accessToken
  const c = await signInAs(await createTestUser(admin, carrier, 'owner'))
  carrierOwner = c.client; carrierOwnerToken = c.accessToken
}, 60_000)
afterAll(async () => {
  await admin.from('org_feature_overrides').delete().eq('org_id', carrier)
  await admin.from('admin_events').delete().eq('org_id', carrier)
  await admin.from('admin_events').delete().eq('org_id', platformOrg)
  await cleanupTestOrg(admin, carrier)
  await cleanupTestOrg(admin, platformOrg)
})

const grant = { feature_key: 'driver_chat', effect: 'grant', reason: 'pilot programme' }
const has = async () => (await carrierOwner.rpc('has_feature', { feature_key: 'driver_chat' })).data

describe('feature overrides', () => {
  it('only sx_owner / sx_finance may set one; support and the carrier itself get 403', async () => {
    expect((await call(sxSupport, 'PUT', grant)).status).toBe(403)
    expect((await call(carrierOwnerToken, 'PUT', grant)).status).toBe(403)
    expect(await has()).toBe(false)
  })

  it('validates its input', async () => {
    expect((await call(sxOwner, 'PUT', { ...grant, effect: 'maybe' })).status).toBe(400)
    expect((await call(sxOwner, 'PUT', { ...grant, reason: '  ' })).status).toBe(400)
    expect((await call(sxOwner, 'PUT', { ...grant, expires_at: 'not a date' })).status).toBe(400)
    expect((await call(sxOwner, 'PUT', { ...grant, feature_key: 'no_such_feature' })).status).toBe(404)
  })

  it('a grant unlocks that one feature immediately, an expiry ends it, and the audit log records who and why', async () => {
    expect((await call(sxFinance, 'PUT', grant)).status).toBe(200)
    expect(await has()).toBe(true)
    expect((await carrierOwner.rpc('has_feature', { feature_key: 'load_expenses' })).data).toBe(false) // only the one feature
    expect((await admin.from('carrier_details').select('tier').eq('org_id', carrier).single()).data?.tier).toBe('starter')

    const { data: events } = await admin.from('admin_events').select('event_type, metadata').eq('org_id', carrier).eq('event_type', 'admin.feature_override')
    expect(events?.[0]?.metadata).toMatchObject({ feature_key: 'driver_chat', effect: 'grant', reason: 'pilot programme' })

    expect((await call(sxOwner, 'PUT', { ...grant, expires_at: new Date(Date.now() - 1000).toISOString() })).status).toBe(200)
    expect(await has()).toBe(false)
  })

  it('a deny beats the tier, and removing the override restores the tier\'s answer', async () => {
    await admin.from('carrier_details').update({ tier: 'growth' }).eq('org_id', carrier)
    expect(await has()).toBe(true)
    expect((await call(sxOwner, 'PUT', { feature_key: 'driver_chat', effect: 'deny', reason: 'abuse review' })).status).toBe(200)
    expect(await has()).toBe(false)
    expect((await call(sxOwner, 'DELETE', { feature_key: 'driver_chat' })).status).toBe(200)
    expect(await has()).toBe(true)
    expect((await call(sxOwner, 'DELETE', { feature_key: 'driver_chat' })).status).toBe(404)
  })
})
