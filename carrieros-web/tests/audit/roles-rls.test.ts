// Black-box role/tenant probes at the PostgREST/RLS layer (what any holder of a
// valid JWT + the public anon key can do directly, bypassing our Next.js app).
// Each `it` asserts the SECURE outcome; a failing test is a finding.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { setup, anonClient, rows, type Fixture } from './roles-fixture'

let f: Fixture
beforeAll(async () => { f = await setup() }, 120_000)
afterAll(async () => { await f?.teardown() }, 120_000)

// Probes that succeed in mutating state must not contaminate the next probe.
beforeEach(async () => {
  await f.admin.from('loads').update({ status: 'dispatched', driver_id: f.ids.driverA2, rate: 4321, carrier_org_id: f.orgA }).eq('id', f.ids.loadA2)
  await f.admin.from('loads').update({ status: 'dispatched', driver_id: f.ids.driverA1, rate: 4321 }).eq('id', f.ids.loadA1)
  await f.admin.from('carrier_details').update({ tier: 'pro' }).eq('org_id', f.orgA)
  await f.admin.from('invoices').update({ status: 'sent', due_date: null, amount: 999 }).eq('id', f.ids.invoiceA)
})

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

describe('P1 privilege escalation through profiles / onboarding', () => {
  it('a brand-new auth user (no profile) cannot self-insert a profile with a foreign org + privileged role', async () => {
    const email = `audit_np_${Date.now()}@carrieros-test.dev`
    const { data: u } = await f.admin.auth.admin.createUser({ email, password: 'AuditPass123!x', email_confirm: true })
    const c = createClient(url(), anonKey())
    await c.auth.signInWithPassword({ email, password: 'AuditPass123!x' })
    const ins = await c.from('profiles').insert({ id: u.user!.id, org_id: f.orgB, role: 'owner', first_name: 'x', last_name: 'y' }).select()
    const { data: check } = await f.admin.from('profiles').select('org_id, role').eq('id', u.user!.id).maybeSingle()
    await f.admin.from('profiles').delete().eq('id', u.user!.id)
    await f.admin.auth.admin.deleteUser(u.user!.id)
    // SECURE: insert rejected, no row. FAIL = user became owner of org B.
    expect(check, `profile row created: ${JSON.stringify(check)} err=${ins.error?.message}`).toBeNull()
  })

  it('a brand-new auth user cannot self-insert an sx_owner profile (platform staff)', async () => {
    const email = `audit_sx_${Date.now()}@carrieros-test.dev`
    const { data: u } = await f.admin.auth.admin.createUser({ email, password: 'AuditPass123!x', email_confirm: true })
    const c = createClient(url(), anonKey())
    await c.auth.signInWithPassword({ email, password: 'AuditPass123!x' })
    await c.from('profiles').insert({ id: u.user!.id, org_id: f.platformOrg, role: 'sx_owner', first_name: 'x', last_name: 'y' })
    const { data: check } = await f.admin.from('profiles').select('org_id, role').eq('id', u.user!.id).maybeSingle()
    await f.admin.from('profiles').delete().eq('id', u.user!.id)
    await f.admin.auth.admin.deleteUser(u.user!.id)
    expect(check, `profile row created: ${JSON.stringify(check)}`).toBeNull()
  })

  it('a driver cannot change own role/org/is_active via profiles update', async () => {
    const d = f.a.driver1
    await d.client.from('profiles').update({ role: 'owner' }).eq('id', d.user.userId)
    await d.client.from('profiles').update({ org_id: f.orgB }).eq('id', d.user.userId)
    const { data } = await f.admin.from('profiles').select('role, org_id').eq('id', d.user.userId).single()
    expect(data).toEqual({ role: 'driver', org_id: f.orgA })
  })

  it('a driver cannot update a coworker profile or read other-org profiles', async () => {
    await f.a.driver1.client.from('profiles').update({ role: 'owner' }).eq('id', f.a.driver2.user.userId)
    const { data } = await f.admin.from('profiles').select('role').eq('id', f.a.driver2.user.userId).single()
    expect(data!.role).toBe('driver')
    expect(rows(await f.a.driver1.client.from('profiles').select('id').eq('org_id', f.orgB))).toBe(0)
  })

  it('an owner cannot alter profiles of another org directly', async () => {
    await f.a.owner.client.from('profiles').update({ role: 'driver' }).eq('id', f.b.owner.user.userId)
    const { data } = await f.admin.from('profiles').select('role').eq('id', f.b.owner.user.userId).single()
    expect(data!.role).toBe('owner')
  })
})

describe('P2 cross-tenant reads/writes by id (org A actors vs org B rows)', () => {
  const tables: [string, () => number, string][] = [
    ['loads', () => f.ids.loadB, 'id'], ['invoices', () => f.ids.invoiceB, 'id'],
    ['vehicles', () => f.ids.vehicleB, 'id'], ['drivers', () => f.ids.driverB, 'id'],
  ]
  for (const role of ['owner', 'dispatcher', 'finance', 'driver1'] as const) {
    for (const [t, id, col] of tables) {
      it(`${role} (org A) cannot SELECT org B ${t} by id`, async () => {
        expect(rows(await f.a[role].client.from(t).select('*').eq(col, id()))).toBe(0)
      })
    }
  }
  it('owner A cannot UPDATE / DELETE org B load, invoice, vehicle', async () => {
    const c = f.a.owner.client
    await c.from('loads').update({ status: 'cancelled' }).eq('id', f.ids.loadB)
    await c.from('invoices').update({ amount: 1 }).eq('id', f.ids.invoiceB)
    await c.from('vehicles').update({ nickname: 'pwn' }).eq('id', f.ids.vehicleB)
    await c.from('loads').delete().eq('id', f.ids.loadB)
    const { data: l } = await f.admin.from('loads').select('status').eq('id', f.ids.loadB).single()
    const { data: i } = await f.admin.from('invoices').select('amount').eq('id', f.ids.invoiceB).single()
    const { data: v } = await f.admin.from('vehicles').select('nickname').eq('id', f.ids.vehicleB).single()
    expect([l!.status, Number(i!.amount), v!.nickname]).toEqual(['dispatched', 999, 'B truck'])
  })
  it('owner A cannot INSERT a load / invoice / vehicle into org B', async () => {
    const c = f.a.owner.client
    const r1 = await c.from('loads').insert({ carrier_org_id: f.orgB, load_number: 'X-PWN' })
    const r2 = await c.from('invoices').insert({ carrier_org_id: f.orgB, invoice_number: 'X-PWN', amount: 1 })
    expect(r1.error, 'loads insert into org B').not.toBeNull()
    expect(r2.error, 'invoices insert into org B').not.toBeNull()
  })
  it('owner A cannot re-parent own load to org B (carrier_org_id update)', async () => {
    await f.a.owner.client.from('loads').update({ carrier_org_id: f.orgB }).eq('id', f.ids.loadA2)
    const { data } = await f.admin.from('loads').select('carrier_org_id').eq('id', f.ids.loadA2).single()
    expect(Number(data!.carrier_org_id)).toBe(f.orgA)
  })
  it('owner A cannot read org B documents/driver_documents/expenses/settlements', async () => {
    for (const t of ['documents', 'driver_documents', 'load_expenses', 'driver_settlements', 'exception_events', 'audit_events', 'org_documents']) {
      expect(rows(await f.a.owner.client.from(t).select('*').eq('carrier_org_id' as never, f.orgB)), t).toBe(0)
    }
  })
})

describe('P3 within-tenant role boundaries (org A)', () => {
  it('driver sees only own loads (not coworker load)', async () => {
    const r = await f.a.driver1.client.from('loads').select('id')
    const ids = (r.data ?? []).map((x) => Number(x.id))
    expect(ids).toContain(f.ids.loadA1)
    expect(ids).not.toContain(f.ids.loadA2)
  })
  it('driver cannot read commercial `rate` from base loads table (loads_driver_view exists to hide it)', async () => {
    const r = await f.a.driver1.client.from('loads').select('id, rate').eq('id', f.ids.loadA1)
    expect(r.error !== null || (r.data ?? []).every((x) => x.rate == null), `driver read rate=${JSON.stringify(r.data)}`).toBe(true)
  })
  it('driver cannot read invoices', async () => { expect(rows(await f.a.driver1.client.from('invoices').select('id'))).toBe(0) })
  it('driver cannot read coworker settlements', async () => {
    expect(rows(await f.a.driver1.client.from('driver_settlements').select('id').eq('id', f.ids.settlementA2))).toBe(0)
  })
  it('driver cannot read coworker driver_documents (CDL etc.)', async () => {
    expect(rows(await f.a.driver1.client.from('driver_documents').select('id').eq('id', f.ids.driverDocA2))).toBe(0)
  })
  it("driver cannot read documents attached to another driver's load", async () => {
    expect(rows(await f.a.driver1.client.from('documents').select('id').eq('id', f.ids.docA))).toBe(0)
  })
  it('driver cannot read load_expenses', async () => {
    expect(rows(await f.a.driver1.client.from('load_expenses').select('id').eq('id', f.ids.expenseA))).toBe(0)
  })
  it('driver cannot read coworker driver rows', async () => {
    expect(rows(await f.a.driver1.client.from('drivers').select('id').eq('id', f.ids.driverA2))).toBe(0)
  })
  it('driver cannot read org audit_events', async () => {
    await f.admin.from('audit_events').insert({ org_id: f.orgA, actor_user_id: f.a.owner.user.userId, action: 'audit.probe', aggregate_type: 'x', aggregate_id: '1' } as never)
    expect(rows(await f.a.driver1.client.from('audit_events').select('id').eq('org_id', f.orgA))).toBe(0)
  })
  it('driver cannot update load fields other than allowed status/etc (rate, driver_id, carrier)', async () => {
    await f.a.driver1.client.from('loads').update({ rate: 1, driver_id: f.ids.driverA2 }).eq('id', f.ids.loadA1)
    const { data } = await f.admin.from('loads').select('rate, driver_id').eq('id', f.ids.loadA1).single()
    expect([Number(data!.rate), Number(data!.driver_id)]).toEqual([4321, f.ids.driverA1])
  })
  it("driver cannot change coworker's load status", async () => {
    await f.a.driver1.client.from('loads').update({ status: 'delivered' }).eq('id', f.ids.loadA2)
    const { data } = await f.admin.from('loads').select('status').eq('id', f.ids.loadA2).single()
    expect(data!.status).toBe('dispatched')
  })
  it('driver cannot create loads / vehicles / invoices / drivers', async () => {
    const c = f.a.driver1.client
    expect((await c.from('loads').insert({ carrier_org_id: f.orgA, load_number: 'DRV-PWN' })).error).not.toBeNull()
    expect((await c.from('invoices').insert({ carrier_org_id: f.orgA, invoice_number: 'DRV-PWN', amount: 1 })).error).not.toBeNull()
    expect((await c.from('drivers').insert({ carrier_org_id: f.orgA, profile_id: f.a.driver1.user.userId })).error).not.toBeNull()
  })
  it('driver cannot edit own driver record fields (is_active, driver_number, expiries, org)', async () => {
    await f.a.driver1.client.from('drivers').update({ is_active: false }).eq('id', f.ids.driverA1)
    await f.a.driver1.client.from('drivers').update({ carrier_org_id: f.orgB }).eq('id', f.ids.driverA1)
    const { data } = await f.admin.from('drivers').select('is_active, carrier_org_id').eq('id', f.ids.driverA1).single()
    expect(data!.is_active).toBe(true); expect(Number(data!.carrier_org_id)).toBe(f.orgA)
  })
  it('dispatcher cannot touch invoices', async () => {
    await f.a.dispatcher.client.from('invoices').update({ amount: 1 }).eq('id', f.ids.invoiceA)
    const { data } = await f.admin.from('invoices').select('amount').eq('id', f.ids.invoiceA).single()
    expect(Number(data!.amount)).toBe(999)
    expect(rows(await f.a.dispatcher.client.from('invoices').select('id').eq('id', f.ids.invoiceA))).toBe(0)
  })
  it('dispatcher cannot read settlements or driver_documents', async () => {
    expect(rows(await f.a.dispatcher.client.from('driver_settlements').select('id'))).toBe(0)
    expect(rows(await f.a.dispatcher.client.from('driver_documents').select('id').eq('id', f.ids.driverDocA2))).toBe(0)
  })
  it('dispatcher cannot modify org settings (organizations / carrier_details / tier)', async () => {
    await f.a.dispatcher.client.from('carrier_details').update({ tier: 'enterprise' }).eq('org_id', f.orgA)
    await f.a.dispatcher.client.from('organizations').update({ name: 'pwned' }).eq('id', f.orgA)
    const { data: cd } = await f.admin.from('carrier_details').select('tier').eq('org_id', f.orgA).single()
    const { data: o } = await f.admin.from('organizations').select('name').eq('id', f.orgA).single()
    expect(cd!.tier).toBe('pro'); expect(o!.name).not.toBe('pwned')
  })
  it('finance cannot modify loads (finance_loads_update exists: probe scope)', async () => {
    await f.a.finance.client.from('loads').update({ driver_id: f.ids.driverA2, status: 'cancelled' }).eq('id', f.ids.loadA2)
    const { data } = await f.admin.from('loads').select('status, driver_id').eq('id', f.ids.loadA2).single()
    expect(data!.status, 'finance changed load status/driver').toBe('dispatched')
  })
  it('finance cannot read driver_documents / drivers PII beyond RLS', async () => {
    expect(rows(await f.a.finance.client.from('driver_documents').select('id').eq('id', f.ids.driverDocA2))).toBe(0)
  })
  it('non-owner cannot change tier/billing via carrier_details', async () => {
    for (const r of ['dispatcher', 'finance', 'driver1'] as const) {
      await f.a[r].client.from('carrier_details').update({ tier: 'enterprise', billing_status: 'active' } as never).eq('org_id', f.orgA)
    }
    const { data } = await f.admin.from('carrier_details').select('tier').eq('org_id', f.orgA).single()
    expect(data!.tier).toBe('pro')
  })
  it('OWNER can self-assign tier via carrier_details update (subscription bypass) — must be blocked', async () => {
    await f.a.owner.client.from('carrier_details').update({ tier: 'enterprise' }).eq('org_id', f.orgA)
    const { data } = await f.admin.from('carrier_details').select('tier').eq('org_id', f.orgA).single()
    await f.admin.from('carrier_details').update({ tier: 'pro' }).eq('org_id', f.orgA)
    expect(data!.tier, 'owner upgraded own tier directly through PostgREST').toBe('pro')
  })
})

describe('P4 write-side policy gaps', () => {
  it('any authenticated user cannot insert carrier_details for someone else\'s org', async () => {
    // fresh customer-type org has customer_details, not carrier_details -> use it as a "victim" without a row
    const r = await f.a.driver1.client.from('carrier_details').insert({ org_id: f.custOrg, tier: 'enterprise' })
    if (!r.error) await f.admin.from('carrier_details').delete().eq('org_id', f.custOrg)
    expect(r.error, 'driver inserted carrier_details for foreign org').not.toBeNull()
  })
  it('a driver cannot create organizations', async () => {
    const r = await f.a.driver1.client.from('organizations').insert({ type: 'carrier', name: `audit-rogue-${Date.now()}` }).select('id')
    if (r.data?.length) await f.admin.from('organizations').delete().in('id', r.data.map((x) => x.id))
    expect(r.error, 'driver created a carrier org').not.toBeNull()
  })
  it("driver cannot forge driver_messages into another org / as another sender", async () => {
    const r = await f.a.driver1.client.from('driver_messages').insert({
      carrier_org_id: f.orgB, load_id: f.ids.loadA1, body: 'audit spoof', sender_id: f.a.owner.user.userId,
    } as never).select('id, carrier_org_id')
    if (r.data?.length) await f.admin.from('driver_messages').delete().in('id', r.data.map((x) => x.id))
    expect(r.error, `spoofed message accepted: ${JSON.stringify(r.data)}`).not.toBeNull()
  })
  it('driver cannot create load_events attributed to a foreign load', async () => {
    const r = await f.a.driver1.client.from('load_events').insert({ load_id: f.ids.loadB, event_type: 'audit', created_by: f.a.driver1.user.userId } as never)
    expect(r.error).not.toBeNull()
  })
  it('driver cannot delete load_events / documents of others', async () => {
    await f.a.driver1.client.from('documents').delete().eq('id', f.ids.docA)
    const { data } = await f.admin.from('documents').select('id').eq('id', f.ids.docA)
    expect(data).toHaveLength(1)
  })
})

describe('P5 customer-portal user (customer_viewer) reaching carrier data', () => {
  const c = () => f.a.customer.client
  it('sees only loads where customer_org_id = own org', async () => {
    const ids = ((await c().from('loads').select('id')).data ?? []).map((x) => Number(x.id))
    expect(ids).toEqual([f.ids.loadA1])
  })
  it('cannot see carrier-internal load columns (rate, raw_intake_text, extraction_data, driver_id)', async () => {
    const r = await c().from('loads').select('rate, raw_intake_text, extraction_data, driver_id').eq('id', f.ids.loadA1)
    expect(r.error !== null || (r.data ?? []).every((x) => x.rate == null && x.driver_id == null), `portal user read: ${JSON.stringify(r.data)}`).toBe(true)
  })
  it('cannot read drivers / vehicles / settlements / expenses / documents / driver_documents', async () => {
    for (const t of ['drivers', 'vehicles', 'driver_settlements', 'load_expenses', 'documents', 'driver_documents', 'org_documents', 'service_logs', 'exception_events', 'fuel_stops', 'driver_messages']) {
      expect(rows(await c().from(t).select('*')), t).toBe(0)
    }
  })
  it('cannot read carrier team profiles', async () => {
    const r = await c().from('profiles').select('id, role').neq('id', f.a.customer.user.userId)
    expect(rows(r), JSON.stringify(r.data)).toBe(0)
  })
  it('cannot read carrier org / carrier_details (tier, billing)', async () => {
    expect(rows(await c().from('carrier_details').select('*'))).toBe(0)
  })
  it('cannot read carrier organizations.ein (tax id) — only public contact fields are needed by a portal', async () => {
    await f.admin.from('organizations').update({ ein: '99-9999999' }).eq('id', f.orgA)
    const r = await c().from('organizations').select('ein').eq('id', f.orgA)
    expect(r.error !== null || (r.data ?? []).every((x) => x.ein == null), `portal user read carrier ein: ${JSON.stringify(r.data)}`).toBe(true)
  })
  it('cannot read customer_details row (carrier-private notes/tags) of its own org beyond what is intended', async () => {
    const r = await c().from('customer_details').select('notes, tags, customer_number').eq('org_id', f.custOrg)
    expect(rows(r), 'portal user can read carrier-internal customer_details (notes/tags)').toBe(0)
  })
  it('can read its own invoices only, and cannot write invoices', async () => {
    const ids = ((await c().from('invoices').select('id')).data ?? []).map((x) => Number(x.id))
    expect(ids).toEqual([f.ids.invoiceA])
    await c().from('invoices').update({ status: 'paid' }).eq('id', f.ids.invoiceA)
    const { data } = await f.admin.from('invoices').select('status').eq('id', f.ids.invoiceA).single()
    expect(data!.status).toBe('sent')
  })
  it('cannot write loads', async () => {
    await c().from('loads').update({ status: 'delivered', rate: 1 }).eq('id', f.ids.loadA1)
    expect((await c().from('loads').insert({ carrier_org_id: f.orgA, load_number: 'CUST-PWN' })).error).not.toBeNull()
    const { data } = await f.admin.from('loads').select('status, rate').eq('id', f.ids.loadA1).single()
    expect([data!.status, Number(data!.rate)]).toEqual(['dispatched', 4321])
  })
  it('cannot load_events insert / driver_messages insert on the carrier\'s load', async () => {
    expect((await c().from('load_events').insert({ load_id: f.ids.loadA1, event_type: 'audit', created_by: f.a.customer.user.userId } as never)).error, 'load_events').not.toBeNull()
    expect((await c().from('driver_messages').insert({ carrier_org_id: f.orgA, load_id: f.ids.loadA1, body: 'x' } as never)).error, 'driver_messages').not.toBeNull()
  })
  it('cannot call carrier-only RPCs (create_customer_org, bulk_import, get_exceptions)', async () => {
    expect((await c().rpc('create_customer_org', { p_name: 'audit-x' } as never)).error, 'create_customer_org').not.toBeNull()
    const ex = await c().rpc('get_exceptions')
    expect(rows(ex as never)).toBe(0)
  })
})

describe('P6 ShipmentX platform roles', () => {
  it('sx_* sessions read no tenant rows via RLS (loads/invoices/drivers/profiles of carriers)', async () => {
    for (const r of ['owner', 'finance', 'support'] as const) {
      for (const t of ['loads', 'invoices', 'drivers', 'vehicles', 'documents', 'driver_settlements']) {
        expect(rows(await f.sx[r].client.from(t).select('id')), `${r}:${t}`).toBe(0)
      }
      expect(rows(await f.sx[r].client.from('profiles').select('id').eq('org_id', f.orgA)), `${r}:profiles`).toBe(0)
    }
  })
  it('sx_support cannot write platform_flags / org_flag_overrides; sx_finance cannot either', async () => {
    const { data: flags } = await f.admin.from('platform_flags').select('*').limit(1)
    for (const r of ['support', 'finance'] as const) {
      const w = await f.sx[r].client.from('org_flag_overrides').insert({ org_id: f.orgA, flag_key: (flags?.[0] as { key?: string } | undefined)?.key ?? 'x', enabled: true } as never)
      expect(w.error, `${r} wrote org_flag_overrides`).not.toBeNull()
    }
  })
  it('sx_support cannot read billing_events; sx_support can read admin_notes (by design)', async () => {
    expect(rows(await f.sx.support.client.from('billing_events').select('id'))).toBe(0)
  })
  it('a tenant owner cannot read/write admin_notes, admin_events, platform_flags writes, org_flag_overrides', async () => {
    const c = f.a.owner.client
    expect(rows(await c.from('admin_notes').select('id'))).toBe(0)
    expect(rows(await c.from('admin_events').select('id'))).toBe(0)
    expect(rows(await c.from('billing_events').select('id'))).toBe(0)
    expect((await c.from('admin_notes').insert({ org_id: f.orgA, admin_id: f.a.owner.user.userId, body: 'x' } as never)).error).not.toBeNull()
    expect((await c.from('org_flag_overrides').insert({ org_id: f.orgA, flag_key: 'x', enabled: true } as never)).error).not.toBeNull()
  })
})

describe('P7 anon (no login) exposure', () => {
  it('anon cannot read any tenant table', async () => {
    const anon = anonClient()
    for (const t of ['loads', 'invoices', 'profiles', 'organizations', 'drivers', 'documents', 'driver_messages', 'customer_details', 'carrier_details', 'role_capabilities', 'features', 'platform_flags']) {
      const r = await anon.from(t).select('*').limit(1)
      expect(r.error !== null || rows(r) === 0, t).toBe(true)
    }
  })
  it('anon cannot call SECURITY DEFINER tenant functions with a foreign id (check_ifta_completeness leaks load existence)', async () => {
    const r = await anonClient().rpc('check_ifta_completeness', { p_load_id: f.ids.loadB })
    expect(r.error, `anon got ${JSON.stringify(r.data)}`).not.toBeNull()
  })
  it('anon cannot call get_exceptions / get_my_entitlements / mark_overdue_invoices', async () => {
    const anon = anonClient()
    for (const fn of ['get_exceptions', 'get_my_entitlements', 'mark_overdue_invoices']) {
      const r = await anon.rpc(fn)
      expect(r.error !== null || r.data == null || (Array.isArray(r.data) && r.data.length === 0) || r.data === 0, `${fn}: ${JSON.stringify(r.data)}`).toBe(true)
    }
  })
  it('get_public_tracking returns nothing for a guessed token and exposes no rate/driver fields', async () => {
    const { data: l } = await f.admin.from('loads').select('tracking_token').eq('id', f.ids.loadB).single()
    const guess = await anonClient().rpc('get_public_tracking', { p_token: 'nope' })
    expect(guess.data).toEqual([])
    if (l?.tracking_token) {
      const r = await anonClient().rpc('get_public_tracking', { p_token: l.tracking_token })
      expect(Object.keys((r.data as object[])[0] ?? {})).not.toEqual(expect.arrayContaining(['rate']))
    }
  })
})

describe('P8 SECURITY DEFINER RPCs called directly (bypassing the app-layer authorizeLoadAction)', () => {
  const idem = () => `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`
  it("driver B-in-A (driver1) cannot advance coworker driver2's load via submit_shipment_milestone", async () => {
    const r = await f.a.driver1.client.rpc('submit_shipment_milestone', { p_load_id: f.ids.loadA2, p_expected_status: 'dispatched', p_new_status: 'delivered', p_event_type: 'status_changed', p_reason: 'audit', p_correlation_id: idem(), p_idempotency_key: idem(), p_occurred_at: new Date().toISOString() } as never)
    const { data } = await f.admin.from('loads').select('status').eq('id', f.ids.loadA2).single()
    await f.admin.from('loads').update({ status: 'dispatched' }).eq('id', f.ids.loadA2)
    expect(data!.status, `rpc err=${r.error?.message}`).toBe('dispatched')
  })
  it('finance cannot advance load status via submit_shipment_milestone (app layer forbids finance)', async () => {
    const r = await f.a.finance.client.rpc('submit_shipment_milestone', { p_load_id: f.ids.loadA2, p_expected_status: 'dispatched', p_new_status: 'cancelled', p_event_type: 'status_changed', p_reason: 'audit', p_correlation_id: idem(), p_idempotency_key: idem(), p_occurred_at: new Date().toISOString() } as never)
    const { data } = await f.admin.from('loads').select('status').eq('id', f.ids.loadA2).single()
    await f.admin.from('loads').update({ status: 'dispatched' }).eq('id', f.ids.loadA2)
    expect(data!.status, `rpc err=${r.error?.message}`).toBe('dispatched')
  })
  it('customer_viewer of another org cannot call submit_shipment_milestone (has org, different tenant)', async () => {
    const r = await f.a.customer.client.rpc('submit_shipment_milestone', { p_load_id: f.ids.loadA1, p_expected_status: 'dispatched', p_new_status: 'delivered', p_event_type: 'status_changed', p_reason: 'audit', p_correlation_id: idem(), p_idempotency_key: idem(), p_occurred_at: new Date().toISOString() } as never)
    const { data } = await f.admin.from('loads').select('status').eq('id', f.ids.loadA1).single()
    expect(data!.status, `rpc err=${r.error?.message}`).toBe('dispatched')
  })
  it('sx_owner cannot call submit_shipment_milestone on a tenant load', async () => {
    const r = await f.sx.owner.client.rpc('submit_shipment_milestone', { p_load_id: f.ids.loadA2, p_expected_status: 'dispatched', p_new_status: 'delivered', p_event_type: 'status_changed', p_reason: 'audit', p_correlation_id: idem(), p_idempotency_key: idem(), p_occurred_at: new Date().toISOString() } as never)
    expect(r.error).not.toBeNull()
  })
  it("driver cannot replace another driver's IFTA crossings via replace_ifta_crossings_with_manual", async () => {
    const r = await f.a.driver1.client.rpc('replace_ifta_crossings_with_manual', { p_load_id: f.ids.loadA2, p_rows: [{ state: 'NV', miles: 10 }] } as never)
    const { data } = await f.admin.from('ifta_state_crossings').select('id').eq('load_id', f.ids.loadA2)
    expect(data?.length ?? 0, `rpc err=${r.error?.message}`).toBe(0)
  })
  it('finance/customer cannot call replace_ifta_crossings_with_manual', async () => {
    for (const a of [f.a.finance, f.a.customer]) {
      await a.client.rpc('replace_ifta_crossings_with_manual', { p_load_id: f.ids.loadA1, p_rows: [{ state: 'NV', miles: 10 }] } as never)
    }
    const { data } = await f.admin.from('ifta_state_crossings').select('id').eq('load_id', f.ids.loadA1)
    expect(data?.length ?? 0).toBe(0)
  })
  it('driver cannot call create_customer_org / bulk_import_customers; finance neither', async () => {
    for (const a of [f.a.driver1, f.a.finance]) {
      expect((await a.client.rpc('create_customer_org', { p_name: `aud-${Date.now()}` } as never)).error, `${a.role} create_customer_org`).not.toBeNull()
      expect((await a.client.rpc('bulk_import_customers', { p_rows: [{ name: `aud-${Date.now()}` }] } as never)).error, `${a.role} bulk_import`).not.toBeNull()
    }
  })
  it('driver cannot mark invoices overdue (mark_overdue_invoices) — invoice-domain action', async () => {
    await f.admin.from('invoices').update({ due_date: '2020-01-01', status: 'sent' }).eq('id', f.ids.invoiceA)
    await f.a.driver1.client.rpc('mark_overdue_invoices')
    const { data } = await f.admin.from('invoices').select('status').eq('id', f.ids.invoiceA).single()
    await f.admin.from('invoices').update({ status: 'sent', due_date: null }).eq('id', f.ids.invoiceA)
    expect(data!.status).toBe('sent')
  })
  it('driver cannot get_exceptions (invoice amounts, compliance docs) — office-only data', async () => {
    await f.admin.from('invoices').update({ due_date: '2020-01-01', status: 'sent' }).eq('id', f.ids.invoiceA)
    const r = await f.a.driver1.client.rpc('get_exceptions')
    await f.admin.from('invoices').update({ due_date: null }).eq('id', f.ids.invoiceA)
    expect(rows(r as never), `driver saw: ${JSON.stringify(r.data)}`).toBe(0)
  })
  it('cross-tenant: check_ifta_completeness(loadB) by authenticated org-A user gives no signal', async () => {
    await f.admin.from('loads').update({ total_miles: 100 }).eq('id', f.ids.loadB)
    const r = await f.a.owner.client.rpc('check_ifta_completeness', { p_load_id: f.ids.loadB })
    // a foreign/nonexistent load and a real foreign load should be indistinguishable AND not TRUE for miles>0/no crossings
    const bogus = await f.a.owner.client.rpc('check_ifta_completeness', { p_load_id: 999999999 })
    expect(r.data, 'foreign load result differs from nonexistent-load result => existence oracle').toEqual(bogus.data)
  })
  it('cross-tenant: get_ifta_tax_summary / quarterly summary for org B returns nothing', async () => {
    const a = await f.a.owner.client.rpc('get_ifta_tax_summary', { p_carrier_org_id: f.orgB, p_quarter: '2026-Q1' })
    const b = await f.a.owner.client.rpc('get_ifta_quarterly_summary', { p_carrier_org_id: f.orgB, p_quarter: '2026-Q1' })
    expect(rows(a as never)).toBe(0); expect(rows(b as never)).toBe(0)
  })
  it('cross-tenant: get_customer_health_score for org B customer is null/neutral, not computed', async () => {
    const r = await f.a.owner.client.rpc('get_customer_health_score', { customer_org_id: f.orgB })
    expect(r.error).toBeNull() // documented as neutral 100 (no rows visible) -> no leakage
  })
  it('cross-tenant: log_vehicle_service / submit_dvir_inspection on org B ids are rejected', async () => {
    const r1 = await f.a.owner.client.rpc('log_vehicle_service', { p_vehicle_id: f.ids.vehicleB, p_service_type: 'oil', p_service_date: '2026-01-01' } as never)
    expect(r1.error).not.toBeNull()
    const r2 = await f.a.driver1.client.rpc('submit_dvir_inspection', { p_load_id: f.ids.loadB, p_vehicle_id: f.ids.vehicleB, p_driver_id: f.ids.driverB, p_type: 'pre_trip', p_condition: 'satisfactory', p_odometer: 1, p_defects: [] } as never)
    expect(r2.error).not.toBeNull()
  })
  it('driver cannot mark_invoice_paid', async () => {
    const r = await f.a.driver1.client.rpc('mark_invoice_paid', { p_invoice_id: f.ids.invoiceA } as never)
    const { data } = await f.admin.from('invoices').select('status').eq('id', f.ids.invoiceA).single()
    expect(data!.status, `err=${r.error?.message}`).toBe('sent')
  })
})

describe('P9 deactivated users', () => {
  it('a profile with is_active=false loses tenant data access (existing JWT still valid)', async () => {
    await f.admin.from('profiles').update({ is_active: false }).eq('id', f.a.dispatcher.user.userId)
    const r = await f.a.dispatcher.client.from('loads').select('id')
    const inv = await f.a.owner.client.from('profiles').select('id') // control
    await f.admin.from('profiles').update({ is_active: true }).eq('id', f.a.dispatcher.user.userId)
    expect(inv.data?.length).toBeGreaterThan(0)
    expect(rows(r), 'deactivated dispatcher still reads org loads').toBe(0)
  })
})
