// tests/security-role-scoping.test.ts — regression tests for migration 0022: RLS enforces the ROLE, not only the tenant.
// Each attack here read data or did something the role had no business doing; they go through real sessions.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setup, type Fixture } from './audit/roles-fixture'

const APP = process.env.TEST_APP_URL ?? 'http://localhost:3000'
let f: Fixture
beforeAll(async () => { f = await setup() }, 120_000)
afterAll(async () => { await f?.teardown() })

const count = async (client: Fixture['a']['owner']['client'], table: string, col: string, val: number) =>
  ((await client.from(table).select('*').eq(col, val)).data ?? []).length

describe('a driver sees their own paperwork, not their coworkers\'', () => {
  it('driver documents (CDL scans): own yes, coworker no, office yes, finance no', async () => {
    const id = f.ids.driverDocA2
    expect(await count(f.a.driver2.client, 'driver_documents', 'id', id)).toBe(1)
    expect(await count(f.a.driver1.client, 'driver_documents', 'id', id)).toBe(0)
    expect(await count(f.a.owner.client, 'driver_documents', 'id', id)).toBe(1)
    expect(await count(f.a.dispatcher.client, 'driver_documents', 'id', id)).toBe(1)
    expect(await count(f.a.finance.client, 'driver_documents', 'id', id)).toBe(0)
  })

  it('load documents: only for their own loads (or ones they uploaded)', async () => {
    const id = f.ids.docA // attached to driver2's load, uploaded by the owner
    expect(await count(f.a.driver2.client, 'documents', 'id', id)).toBe(1)
    expect(await count(f.a.driver1.client, 'documents', 'id', id)).toBe(0)
    expect(await count(f.a.owner.client, 'documents', 'id', id)).toBe(1)
    expect(await count(f.a.finance.client, 'documents', 'id', id)).toBe(1)
  })

  it('load expenses: office and finance only', async () => {
    const id = f.ids.expenseA
    expect(await count(f.a.driver2.client, 'load_expenses', 'id', id)).toBe(0)
    for (const who of [f.a.owner, f.a.dispatcher, f.a.finance]) expect(await count(who.client, 'load_expenses', 'id', id), who.role).toBe(1)
  })
})

describe('customer records are for office roles', () => {
  it('a driver cannot list the carrier\'s customers; a portal login cannot read the carrier-side customer row', async () => {
    expect(await count(f.a.driver1.client, 'customer_details', 'org_id', f.custOrg)).toBe(0)
    expect(await count(f.a.customer.client, 'customer_details', 'org_id', f.custOrg)).toBe(0)
    for (const who of [f.a.owner, f.a.dispatcher, f.a.finance]) expect(await count(who.client, 'customer_details', 'org_id', f.custOrg), who.role).toBe(1)
  })
})

describe('finance can bill a load, not rewrite it', () => {
  it('may move a load to invoiced, but not change the rate, the driver, or the status to anything else', async () => {
    const before = (await f.admin.from('loads').select('rate, status, driver_id').eq('id', f.ids.loadA1).single()).data
    expect((await f.a.finance.client.from('loads').update({ rate: 1 }).eq('id', f.ids.loadA1)).error).not.toBeNull()
    expect((await f.a.finance.client.from('loads').update({ driver_id: f.ids.driverA2 }).eq('id', f.ids.loadA1)).error).not.toBeNull()
    expect((await f.a.finance.client.from('loads').update({ status: 'cancelled' }).eq('id', f.ids.loadA1)).error).not.toBeNull()
    expect((await f.admin.from('loads').select('rate, status, driver_id').eq('id', f.ids.loadA1).single()).data).toEqual(before)
    expect((await f.a.finance.client.from('loads').update({ status: 'invoiced' }).eq('id', f.ids.loadA1)).error).toBeNull()
    await f.admin.from('loads').update({ status: 'dispatched' }).eq('id', f.ids.loadA1)
  })
})

describe('office-only functions', () => {
  it('a driver gets no exceptions and cannot mark invoices overdue; the owner can do both', async () => {
    const { data: inv } = await f.admin.from('invoices').insert({
      carrier_org_id: f.orgA, load_id: f.ids.loadA2, invoice_number: `SCOPE-${Date.now()}`, amount: 77, status: 'sent',
      due_date: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
    }).select('id').single()
    try {
      expect(((await f.a.driver1.client.rpc('get_exceptions')).data ?? []).length).toBe(0)
      expect((await f.a.driver1.client.rpc('mark_overdue_invoices')).data).toBe(0)
      expect((await f.admin.from('invoices').select('status').eq('id', inv!.id).single()).data?.status).toBe('sent')

      const seen = ((await f.a.owner.client.rpc('get_exceptions')).data ?? []) as { detail: string }[]
      expect(seen.some((e) => e.detail.includes('$77'))).toBe(true)
      expect(((await f.a.owner.client.rpc('mark_overdue_invoices')).data as number)).toBeGreaterThanOrEqual(1)
    } finally { await f.admin.from('invoices').delete().eq('id', inv!.id) }
  })

  it('/api/extract-load (a paid LLM call) is for the roles that create loads', async () => {
    const post = (token: string) => fetch(`${APP}/api/extract-load`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'ab' }) })
    expect((await post(f.a.driver1.token)).status).toBe(403)
    expect((await post(f.a.finance.token)).status).toBe(403)
    expect((await post(f.a.dispatcher.token)).status).toBe(400) // past the role gate, stopped by validation: no LLM call
  })
})

describe('deactivation reaches every policy, not just the helpers', () => {
  it('a deactivated dispatcher loses loads/documents/customers at once; reactivating restores them', async () => {
    const uid = f.a.dispatcher.user.userId
    expect(await count(f.a.dispatcher.client, 'loads', 'id', f.ids.loadA1)).toBe(1)
    await f.admin.from('profiles').update({ is_active: false }).eq('id', uid)
    try {
      expect(await count(f.a.dispatcher.client, 'loads', 'id', f.ids.loadA1)).toBe(0)
      expect(await count(f.a.dispatcher.client, 'documents', 'id', f.ids.docA)).toBe(0)
      expect(await count(f.a.dispatcher.client, 'customer_details', 'org_id', f.custOrg)).toBe(0)
    } finally { await f.admin.from('profiles').update({ is_active: true }).eq('id', uid) }
    expect(await count(f.a.dispatcher.client, 'loads', 'id', f.ids.loadA1)).toBe(1)
  })

  it('a deactivated driver loses their own loads, and cannot write chat or documents', async () => {
    const uid = f.a.driver1.user.userId
    expect(await count(f.a.driver1.client, 'loads', 'id', f.ids.loadA1)).toBe(1)
    await f.admin.from('profiles').update({ is_active: false }).eq('id', uid)
    try {
      expect(await count(f.a.driver1.client, 'loads', 'id', f.ids.loadA1)).toBe(0)
      const msg = await f.a.driver1.client.from('driver_messages').insert({ carrier_org_id: f.orgA, load_id: f.ids.loadA1, sender_id: uid, body: 'x', original_language: 'en' })
      expect(msg.error).not.toBeNull()
    } finally { await f.admin.from('profiles').update({ is_active: true }).eq('id', uid) }
  })

  it('a user can still read their own profile after deactivation (so the app can tell them why)', async () => {
    const uid = f.a.dispatcher.user.userId
    await f.admin.from('profiles').update({ is_active: false }).eq('id', uid)
    try {
      expect(((await f.a.dispatcher.client.from('profiles').select('id').eq('id', uid)).data ?? []).length).toBe(1)
    } finally { await f.admin.from('profiles').update({ is_active: true }).eq('id', uid) }
  })
})
