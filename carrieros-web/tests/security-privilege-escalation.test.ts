// tests/security-privilege-escalation.test.ts — regression tests for migrations 0019/0020 and the route fixes
// that closed the paths found by the 2026-09-20 roles/tenancy audit. Each case is an attack that worked before.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { setup, anonClient, type Fixture } from './audit/roles-fixture'

const APP = process.env.TEST_APP_URL ?? 'http://localhost:3000'
let f: Fixture
beforeAll(async () => { f = await setup() }, 120_000)
afterAll(async () => { await f?.teardown() })

const api = (token: string, method: string, path: string, body?: unknown) =>
  fetch(`${APP}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })

// A signed-in user with NO profile yet: the state every self-serve signup passes through.
async function newcomer() {
  const email = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@carrieros-test.dev`
  const { data: u } = await f.admin.auth.admin.createUser({ email, password: 'SecPass123!xyz', email_confirm: true })
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data: s } = await c.auth.signInWithPassword({ email, password: 'SecPass123!xyz' })
  const id = u.user!.id
  return { id, client: c, token: s.session!.access_token, done: async () => { await f.admin.from('profiles').delete().eq('id', id); await f.admin.auth.admin.deleteUser(id) } }
}

describe('nobody can mint their own tenant membership or platform role', () => {
  it('cannot insert a profile into someone else\'s org, as owner or as sx_owner', async () => {
    const n = await newcomer()
    try {
      for (const role of ['owner', 'sx_owner']) {
        const { error } = await n.client.from('profiles').insert({ id: n.id, org_id: f.orgA, role })
        expect(error, `insert as ${role}`).not.toBeNull()
      }
      expect((await f.admin.from('profiles').select('id').eq('id', n.id)).data).toEqual([])
    } finally { await n.done() }
  })

  it('cannot create organizations or carrier_details directly', async () => {
    const n = await newcomer()
    try {
      expect((await n.client.from('organizations').insert({ type: 'carrier', name: 'Sec Org' })).error).not.toBeNull()
      expect((await n.client.from('carrier_details').insert({ org_id: f.custOrg })).error).not.toBeNull()
    } finally { await n.done() }
  })

  it('self-serve onboarding refuses a platform or portal role and creates nothing', async () => {
    const n = await newcomer()
    try {
      for (const role of ['sx_owner', 'customer_admin', 'driver', 'finance']) {
        const res = await api(n.token, 'POST', '/api/onboarding', { company_name: 'Sec Co', state: 'TX', first_name: 'a', last_name: 'b', role })
        expect(res.status, role).toBe(400)
      }
      expect((await f.admin.from('profiles').select('id').eq('id', n.id)).data).toEqual([])
    } finally { await n.done() }
  })
})

describe('subscription state is server-write-only', () => {
  it('an owner cannot change their own tier, billing status, trial or card fields', async () => {
    const before = (await f.admin.from('carrier_details').select('tier, billing_status, trial_ends_at, stripe_customer_id').eq('org_id', f.orgA).single()).data
    for (const patch of [{ tier: 'starter' }, { billing_status: 'active' }, { trial_ends_at: '2099-01-01T00:00:00Z' }, { stripe_customer_id: 'cus_FORGED' }, { card_last4: '0000' }]) {
      await f.a.owner.client.from('carrier_details').update(patch).eq('org_id', f.orgA)
    }
    const after = (await f.admin.from('carrier_details').select('tier, billing_status, trial_ends_at, stripe_customer_id').eq('org_id', f.orgA).single()).data
    expect(after).toEqual(before)
  })
})

describe('shipment commands decide WHO may act, not just which tenant', () => {
  const milestone = (client: Fixture['a']['driver1']['client'], loadId: number, to = 'delivered') =>
    client.rpc('submit_shipment_milestone', { p_load_id: loadId, p_expected_status: 'dispatched', p_new_status: to, p_event_type: 'x', p_reason: 'sec', p_correlation_id: 'sec', p_idempotency_key: `sec-${Date.now()}-${Math.random()}`, p_occurred_at: new Date().toISOString() })

  it('a driver cannot advance a coworker\'s load; finance cannot advance any load', async () => {
    expect((await milestone(f.a.driver2.client, f.ids.loadA1)).error).not.toBeNull()
    expect((await milestone(f.a.finance.client, f.ids.loadA1, 'cancelled')).error).not.toBeNull()
    expect((await f.admin.from('loads').select('status').eq('id', f.ids.loadA1).single()).data?.status).toBe('dispatched')
  })

  it('a driver cannot rewrite a coworker\'s IFTA crossings; finance cannot either', async () => {
    for (const who of [f.a.driver2, f.a.finance]) {
      const { error } = await who.client.rpc('replace_ifta_crossings_with_manual', { p_load_id: f.ids.loadA1, p_rows: [{ state: 'NV', miles: 10 }] })
      expect(error, who.role).not.toBeNull()
    }
    expect((await f.admin.from('ifta_state_crossings').select('id').eq('load_id', f.ids.loadA1).eq('state', 'NV')).data).toEqual([])
  })

  it('anon cannot probe another tenant\'s load through check_ifta_completeness', async () => {
    expect((await anonClient().rpc('check_ifta_completeness', { p_load_id: f.ids.loadB })).error).not.toBeNull()
  })
})

describe('driver chat rows', () => {
  it('a driver cannot forge the org or sender, and may only flip read_at on an existing message', async () => {
    const own = { load_id: f.ids.loadA1, original_language: 'en', body: 'hi' }
    const d = f.a.driver1
    expect((await d.client.from('driver_messages').insert({ ...own, carrier_org_id: f.orgB, sender_id: d.user.userId })).error, 'foreign org').not.toBeNull()
    expect((await d.client.from('driver_messages').insert({ ...own, carrier_org_id: f.orgA, sender_id: f.a.owner.user.userId })).error, 'forged sender').not.toBeNull()
    const ok = await d.client.from('driver_messages').insert({ ...own, carrier_org_id: f.orgA, sender_id: d.user.userId }).select('id').single()
    expect(ok.error).toBeNull()
    const id = ok.data!.id
    expect((await d.client.from('driver_messages').update({ body: 'edited' }).eq('id', id).select('id')).error, 'body edit').not.toBeNull()
    expect((await d.client.from('driver_messages').update({ read_at: new Date().toISOString() }).eq('id', id).select('id')).error, 'read_at').toBeNull()
  })
})

describe('foreign ids cannot be attached to your own rows', () => {
  it('a carrier cannot assign another carrier\'s driver or vehicle to a load (API answers 400)', async () => {
    const res = await api(f.a.owner.token, 'PATCH', `/api/loads/${f.ids.loadA2}`, { driver_id: f.ids.driverB, vehicle_id: f.ids.vehicleB })
    expect(res.status).toBe(400)
    expect((await f.admin.from('loads').select('driver_id').eq('id', f.ids.loadA2).single()).data?.driver_id).not.toBe(f.ids.driverB)
  })

  it('a wrong-tenant load PATCH is a 404, not a silent success', async () => {
    expect((await api(f.a.owner.token, 'PATCH', `/api/loads/${f.ids.loadB}`, { status: 'cancelled' })).status).toBe(404)
  })

  it('a carrier cannot attach a contact to another tenant\'s org, so cannot invite into it', async () => {
    const res = await api(f.a.owner.token, 'POST', `/api/customers/${f.orgB}/contacts`, { name: 'Intruder', email: 'intruder@example.com' })
    expect(res.status).toBe(404)
    expect((await f.admin.from('customer_contacts').select('id').eq('org_id', f.orgB).eq('carrier_org_id', f.orgA)).data).toEqual([])
    // and the database refuses it on its own, whichever route is used
    expect((await f.a.owner.client.from('customer_contacts').insert({ org_id: f.orgB, carrier_org_id: f.orgA, name: 'x' })).error).not.toBeNull()
  })
})
