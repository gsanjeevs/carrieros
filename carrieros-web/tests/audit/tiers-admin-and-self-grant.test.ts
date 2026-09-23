// AUDIT PROBE part 2: (a) can a ShipmentX admin assign/override tier and does it bite immediately,
// (b) can a carrier self-grant tier / billing standing, (c) do org_flag_overrides / delinquency actually affect
// entitlements. RED test == gap. Throwaway orgs only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch, type TestOrg } from '../helpers'

const admin = adminClient()
let carrier: TestOrg
let platform: { orgId: number }
let owner: Awaited<ReturnType<typeof signInAs>>
let sxOwner: Awaited<ReturnType<typeof signInAs>>
let sxFinance: Awaited<ReturnType<typeof signInAs>>
let sxSupport: Awaited<ReturnType<typeof signInAs>>
let driver: Awaited<ReturnType<typeof signInAs>>
let loadId: number
const j = (t: string, path: string, method: string, body?: unknown) => apiFetch(path, t, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const hf = async (k = 'driver_chat') => (await owner.client.rpc('has_feature', { feature_key: k })).data
const cd = async () => (await admin.from('carrier_details').select('tier,billing_status,trial_ends_at,grace_period_until').eq('org_id', carrier.orgId).single()).data!
const chat = () => j(driver.accessToken, '/api/driver-messages', 'POST', { load_id: loadId, body: 'probe' })
const createdFlags: string[] = []

beforeAll(async () => {
  carrier = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  const { data: p } = await admin.from('organizations').insert({ type: 'platform', name: `Audit Platform ${Date.now()}` }).select('id').single()
  platform = { orgId: Number(p!.id) }
  owner = await signInAs(await createTestUser(admin, carrier.orgId, 'owner'))
  const d = await createTestUser(admin, carrier.orgId, 'driver')
  driver = await signInAs(d)
  sxOwner = await signInAs(await createTestUser(admin, platform.orgId, 'sx_owner'))
  sxFinance = await signInAs(await createTestUser(admin, platform.orgId, 'sx_finance'))
  sxSupport = await signInAs(await createTestUser(admin, platform.orgId, 'sx_support'))
  const driverId = Number((await admin.from('drivers').insert({ carrier_org_id: carrier.orgId, profile_id: d.userId }).select('id').single()).data!.id)
  loadId = Number((await admin.from('loads').insert({ carrier_org_id: carrier.orgId, load_number: `AUD2-${Date.now()}`, status: 'in_transit', driver_id: driverId }).select('id').single()).data!.id)
})
afterAll(async () => {
  for (const k of createdFlags) await admin.from('platform_flags').delete().eq('flag_key', k)
  await admin.from('driver_messages').delete().eq('carrier_org_id', carrier.orgId)
  await admin.from('admin_events').delete().eq('org_id', carrier.orgId)
  await cleanupTestOrg(admin, carrier.orgId)
  await cleanupTestOrg(admin, platform.orgId)
})

describe('ShipmentX admin sets the tier: /api/admin/orgs/:id/tier', () => {
  it('sx_support and carrier owner are forbidden; bad tier is 400', async () => {
    expect((await j(sxSupport.accessToken, `/api/admin/orgs/${carrier.orgId}/tier`, 'PATCH', { tier: 'pro' })).status).toBe(403)
    expect((await j(owner.accessToken, `/api/admin/orgs/${carrier.orgId}/tier`, 'PATCH', { tier: 'pro' })).status).toBe(403)
    expect((await j(sxFinance.accessToken, `/api/admin/orgs/${carrier.orgId}/tier`, 'PATCH', { tier: 'platinum' })).status).toBe(400)
    expect((await cd()).tier).toBe('starter')
  })
  it('sx_finance upgrade takes effect on the carrier\'s very next request (RPC + API), and is audited', async () => {
    expect(await hf()).toBe(false)
    expect((await chat()).status).toBe(403)
    expect((await j(sxFinance.accessToken, `/api/admin/orgs/${carrier.orgId}/tier`, 'PATCH', { tier: 'growth' })).status).toBe(200)
    expect(await hf()).toBe(true)
    expect(await hf('ifta_tax_hub')).toBe(false) // pro feature still off on growth
    expect((await chat()).status).not.toBe(403)
    const { data } = await admin.from('admin_events').select('metadata').eq('org_id', carrier.orgId).eq('event_type', 'admin.change_tier')
    expect(data?.length).toBeGreaterThan(0)
  })
  it('sx_owner downgrade takes effect immediately (no cached entitlement)', async () => {
    expect((await j(sxOwner.accessToken, `/api/admin/orgs/${carrier.orgId}/tier`, 'PATCH', { tier: 'starter' })).status).toBe(200)
    expect(await hf()).toBe(false)
    expect((await chat()).status).toBe(403)
  })
  it('admin can also read carrier detail and set trial / grace period', async () => {
    expect((await j(sxSupport.accessToken, `/api/admin/orgs/${carrier.orgId}`, 'GET')).status).toBe(200)
    expect((await j(sxFinance.accessToken, `/api/admin/orgs/${carrier.orgId}/grace-period`, 'PATCH', { days: 5 })).status).toBe(200)
    expect((await j(sxFinance.accessToken, `/api/admin/orgs/${carrier.orgId}/grace-period`, 'PATCH', { days: null })).status).toBe(200)
  })
})

describe('SELF-GRANT: can the carrier bypass the admin and set its own tier / standing?', () => {
  it('owner cannot PATCH carrier_details.tier directly via PostgREST', async () => {
    await owner.client.from('carrier_details').update({ tier: 'enterprise' }).eq('org_id', carrier.orgId)
    expect((await cd()).tier, 'owner self-upgraded to enterprise with own JWT, no payment, no audit row').toBe('starter')
  })
  it('owner cannot extend own trial / clear billing_status / set own grace period via PostgREST', async () => {
    const future = new Date(Date.now() + 3650 * 864e5).toISOString()
    await owner.client.from('carrier_details').update({ trial_ends_at: future, billing_status: 'active', grace_period_until: future }).eq('org_id', carrier.orgId)
    const c = await cd()
    expect(c.billing_status).toBe('trialing')
    expect(new Date(c.trial_ends_at!).getTime()).toBeLessThan(Date.now() + 100 * 864e5)
    expect(c.grace_period_until).toBeNull()
  })
  it('POST /api/billing/change-tier by the owner does not grant a paid tier without payment (documented demo seam)', async () => {
    await j(owner.accessToken, '/api/billing/change-tier', 'POST', { tier: 'enterprise' })
    expect((await cd()).tier, 'demo seam: no Stripe, no payment-method check, no admin approval').toBe('starter')
    await admin.from('carrier_details').update({ tier: 'starter' }).eq('org_id', carrier.orgId)
  })
  it('a carrier cannot write platform_flags / org_flag_overrides or call admin routes', async () => {
    await admin.from('platform_flags').upsert({ flag_key: 'audit_probe_flag', description: 'probe', default_enabled: false })
    createdFlags.push('audit_probe_flag')
    const ins = await owner.client.from('org_flag_overrides').insert({ org_id: carrier.orgId, flag_key: 'audit_probe_flag', enabled: true })
    expect(ins.error).not.toBeNull()
    const upd = await owner.client.from('platform_flags').update({ default_enabled: true }).eq('flag_key', 'audit_probe_flag').select()
    expect(upd.data ?? []).toEqual([])
    expect((await j(owner.accessToken, '/api/admin/flags/override', 'POST', { org_id: carrier.orgId, flag_key: 'audit_probe_flag', enabled: true })).status).toBe(403)
    expect((await j(owner.accessToken, '/api/admin/flags', 'GET')).status).toBe(403)
  })
  it('sx_finance/sx_support cannot set flag overrides (sx_owner only)', async () => {
    for (const t of [sxFinance, sxSupport])
      expect((await j(t.accessToken, '/api/admin/flags/override', 'POST', { org_id: carrier.orgId, flag_key: 'audit_probe_flag', enabled: true })).status).toBe(403)
  })
})

describe('org_flag_overrides / platform_flags actually change entitlements?', () => {
  it('a deny override on driver_chat blocks a GROWTH org (per entitlement model doc)', async () => {
    await admin.from('carrier_details').update({ tier: 'growth' }).eq('org_id', carrier.orgId)
    const { data: existing } = await admin.from('platform_flags').select('flag_key').eq('flag_key', 'driver_chat').maybeSingle()
    if (!existing) { await admin.from('platform_flags').insert({ flag_key: 'driver_chat', description: 'probe', default_enabled: true }); createdFlags.push('driver_chat') }
    const r = await j(sxOwner.accessToken, '/api/admin/flags/override', 'POST', { org_id: carrier.orgId, flag_key: 'driver_chat', enabled: false })
    expect(r.status).toBe(200) // admin API accepted it
    expect(await hf(), 'override stored but has_feature ignores org_flag_overrides').toBe(false)
    expect((await chat()).status, 'chat API still serves the org').toBe(403)
    await admin.from('org_flag_overrides').delete().eq('org_id', carrier.orgId)
  })
  it('a global platform kill switch (default_enabled=false) blocks driver_chat for everyone', async () => {
    await admin.from('platform_flags').update({ default_enabled: false }).eq('flag_key', 'driver_chat')
    expect(await hf(), 'kill switch ignored by has_feature').toBe(false)
  })
  it('a GRANT override (enabled=true) gives a starter org a growth feature', async () => {
    await admin.from('carrier_details').update({ tier: 'starter' }).eq('org_id', carrier.orgId)
    await admin.from('org_flag_overrides').upsert({ org_id: carrier.orgId, flag_key: 'driver_chat', enabled: true })
    expect(await hf(), 'admin has no working way to grant a single feature short of changing tier').toBe(true)
    await admin.from('org_flag_overrides').delete().eq('org_id', carrier.orgId)
  })
})

describe('subscription standing (billing_status / trial_ends_at / grace)', () => {
  it('canceled subscription loses gated features', async () => {
    await admin.from('carrier_details').update({ tier: 'growth', billing_status: 'canceled' }).eq('org_id', carrier.orgId)
    expect(await hf(), 'canceled org keeps growth features').toBe(false)
  })
  it('expired trial (billing_status=trialing, trial_ends_at in the past, no grace) loses gated features', async () => {
    await admin.from('carrier_details').update({ tier: 'growth', billing_status: 'trialing', trial_ends_at: new Date(Date.now() - 864e5).toISOString() }).eq('org_id', carrier.orgId)
    expect(await hf(), 'expired trial keeps growth features').toBe(false)
    expect((await chat()).status).toBe(403)
  })
  it('past_due with expired grace loses gated features', async () => {
    await admin.from('carrier_details').update({ billing_status: 'past_due', grace_period_until: new Date(Date.now() - 864e5).toISOString() }).eq('org_id', carrier.orgId)
    expect(await hf()).toBe(false)
  })
})
