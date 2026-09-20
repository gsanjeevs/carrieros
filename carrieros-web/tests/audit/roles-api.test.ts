// Black-box HTTP probes against the RUNNING app (TEST_APP_URL, default :3100 for the audit):
// wrong-role callers, cross-tenant ids, portal users and non-sx users on /api/admin/*.
// Each `it` asserts the SECURE outcome; a failing test is a finding.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { setup, type Fixture, type Actor } from './roles-fixture'
import { apiFetch } from '../helpers'

let f: Fixture
beforeAll(async () => { f = await setup() }, 120_000)
afterAll(async () => { await f?.teardown() }, 120_000)

beforeEach(async () => {
  await f.admin.from('loads').update({ status: 'dispatched', driver_id: f.ids.driverA2, vehicle_id: null, customer_org_id: null }).eq('id', f.ids.loadA2)
  await f.admin.from('loads').update({ status: 'dispatched' }).in('id', [f.ids.loadA1, f.ids.loadB])
  await f.admin.from('invoices').update({ status: 'sent', amount: 999, opened_at: null }).in('id', [f.ids.invoiceA, f.ids.invoiceB])
})

const BASE = () => process.env.TEST_APP_URL ?? 'http://localhost:3000'
let n = 0
const idem = () => ({ 'Idempotency-Key': `audit-key-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}` })
type Req = { method: string; path: string; body?: unknown; idem?: boolean }
async function call(token: string | null, r: Req) {
  const init: RequestInit = { method: r.method, headers: r.idem ? idem() : {}, body: r.body === undefined ? undefined : JSON.stringify(r.body) }
  const res = token ? await apiFetch(r.path, token, init) : await fetch(`${BASE()}${r.path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers as object) } })
  let json: unknown = null
  try { json = await res.json() } catch { /* non-json */ }
  return { status: res.status, json }
}
const denied = (s: number) => s === 401 || s === 403 || s === 404
const show = (r: { status: number; json: unknown }) => `status=${r.status} body=${JSON.stringify(r.json).slice(0, 160)}`

// Endpoints an office/owner role uses; body is minimally valid so a wrong-role call is refused for ROLE reasons.
const officeEndpoints = (): Req[] => [
  { method: 'GET', path: '/api/team' },
  { method: 'POST', path: '/api/team/invite', body: { email: `aud_${Date.now()}@carrieros-test.dev`, first_name: 'a', last_name: 'b', role: 'dispatcher' } },
  { method: 'PATCH', path: `/api/team/${f.a.dispatcher.user.userId}`, body: { role: 'finance' } },
  { method: 'DELETE', path: `/api/team/${f.a.dispatcher.user.userId}` },
  { method: 'POST', path: '/api/drivers/invite', body: { email: `aud_${Date.now()}@carrieros-test.dev`, first_name: 'a', last_name: 'b' } },
  { method: 'POST', path: '/api/vehicles', body: { nickname: 'aud', vehicle_type_id: 1 } },
  { method: 'POST', path: '/api/loads', body: { pickup_city: 'x', delivery_city: 'y' } },
  { method: 'PATCH', path: `/api/loads/${f.ids.loadA2}`, body: { status: 'cancelled' } },
  { method: 'GET', path: '/api/loads/export' },
  { method: 'POST', path: `/api/loads/${f.ids.loadA2}/send-documents`, body: { to: 'x@example.com' } },
  { method: 'POST', path: `/api/invoices/${f.ids.invoiceA}/send`, body: {} },
  { method: 'POST', path: `/api/invoices/${f.ids.invoiceA}/factor`, body: { factoring_company: 'aud' } },
  { method: 'POST', path: '/api/settlements/run', body: { driver_id: f.ids.driverA2, period_start: '2026-01-01', period_end: '2026-01-31' } },
  { method: 'POST', path: '/api/settlements/1/send-ach', body: {} },
  { method: 'POST', path: '/api/billing/change-tier', body: { tier: 'enterprise' } },
  { method: 'POST', path: '/api/billing/add-payment-method', body: {} },
  { method: 'POST', path: '/api/customers', body: { name: `aud-cust-${Date.now()}` } },
  { method: 'POST', path: '/api/customers/bulk-import', body: { rows: [{ name: `aud-bulk-${Date.now()}` }] } },
  { method: 'POST', path: `/api/customers/${f.custOrg}/contacts`, body: { name: 'aud', email: 'aud@example.com' } },
  { method: 'PATCH', path: `/api/v1/invoices/${f.ids.invoiceA}`, body: { amount: 1 }, idem: true },
  { method: 'POST', path: `/api/v1/invoices/${f.ids.invoiceA}/mark-paid`, body: {}, idem: true },
  { method: 'POST', path: `/api/v1/vehicles/${f.ids.vehicleB}/service-logs`, body: { service_type: 'oil', service_date: '2026-01-01' }, idem: true },
]

describe('A1 unauthenticated callers are rejected everywhere (401)', () => {
  it('no token / garbage token on every authenticated route', async () => {
    const reqs: Req[] = [
      ...officeEndpoints(),
      { method: 'GET', path: '/api/drivers' }, { method: 'GET', path: '/api/vehicles' }, { method: 'GET', path: '/api/customers' },
      { method: 'GET', path: `/api/customers/${f.custOrg}/contacts` }, { method: 'POST', path: '/api/extract-load', body: { text: 'x'.repeat(30) } },
      { method: 'POST', path: '/api/onboarding', body: {} }, { method: 'GET', path: '/api/v1/me' }, { method: 'GET', path: '/api/v1/loads' },
      { method: 'GET', path: '/api/v1/events' }, { method: 'GET', path: '/api/admin/orgs' }, { method: 'GET', path: '/api/admin/audit' },
      { method: 'GET', path: '/api/admin/billing' }, { method: 'GET', path: '/api/admin/flags' }, { method: 'GET', path: '/api/admin/pipeline' },
      { method: 'PATCH', path: `/api/admin/orgs/${f.orgA}/tier`, body: { tier: 'enterprise' } }, { method: 'POST', path: `/api/admin/orgs/${f.orgA}/impersonate`, body: {} },
      { method: 'POST', path: '/api/driver-messages', body: { load_id: f.ids.loadA1, body: 'x' } },
    ]
    const bad: string[] = []
    for (const r of reqs) {
      for (const tok of [null, 'garbage.token.value']) {
        const res = await call(tok, r)
        if (res.status !== 401) bad.push(`${r.method} ${r.path} tok=${tok ? 'garbage' : 'none'} -> ${res.status}`)
      }
    }
    expect(bad.join('\n')).toBe('')
  })
})

describe('A2 wrong-role callers on owner/dispatcher/finance endpoints', () => {
  const cases: { actor: () => Actor; label: string; allow: RegExp }[] = [
    // `allow` = endpoints (by "METHOD path-prefix") this role legitimately may call
    { actor: () => f.a.driver1, label: 'driver', allow: /^$/ },
    { actor: () => f.a.customer, label: 'customer_viewer', allow: /^$/ },
    { actor: () => f.sx.owner, label: 'sx_owner (platform staff on tenant API)', allow: /^$/ },
    { actor: () => f.a.finance, label: 'finance', allow: /^(GET \/api\/loads\/export|POST \/api\/invoices\/|POST \/api\/settlements\/|PATCH \/api\/v1\/invoices|POST \/api\/v1\/invoices)/ },
    { actor: () => f.a.dispatcher, label: 'dispatcher', allow: /^(POST \/api\/loads$|PATCH \/api\/loads\/|POST \/api\/loads\/.*send-documents|POST \/api\/customers)/ },
  ]
  for (const c of cases) {
    it(`${c.label} is refused on every endpoint outside its remit`, async () => {
      const bad: string[] = []
      for (const r of officeEndpoints()) {
        if (c.allow.test(`${r.method} ${r.path}`)) continue
        const res = await call(c.actor().token, r)
        // Cross-tenant vehicle id in the service-log probe is denied for every role; that is fine.
        if (!denied(res.status)) bad.push(`${r.method} ${r.path} -> ${show(res)}`)
      }
      expect(bad.join('\n')).toBe('')
    })
  }
  it('every role but owner/solo is refused team management (incl. dispatcher/finance self-promotion)', async () => {
    const bad: string[] = []
    for (const a of [f.a.dispatcher, f.a.finance, f.a.driver1, f.a.customer]) {
      const r = await call(a.token, { method: 'PATCH', path: `/api/team/${a.user.userId}`, body: { role: 'owner' } })
      if (!denied(r.status)) bad.push(`${a.role} self-promote -> ${show(r)}`)
    }
    const { data } = await f.admin.from('profiles').select('id, role').in('id', [f.a.dispatcher.user.userId, f.a.finance.user.userId, f.a.driver1.user.userId, f.a.customer.user.userId])
    expect((data ?? []).map((p) => p.role).sort()).toEqual(['customer_viewer', 'dispatcher', 'driver', 'finance'])
    expect(bad.join('\n')).toBe('')
  })
  it('read endpoints with no role gate: driver sees only own driver row and NO customer list/contacts; portal sees nothing', async () => {
    const bad: string[] = []
    const d = f.a.driver1
    const dr = await call(d.token, { method: 'GET', path: '/api/drivers' })
    if (!(denied(dr.status) || (Array.isArray(dr.json) && dr.json.length <= 1))) bad.push(`driver GET /api/drivers -> ${show(dr)}`)
    for (const path of ['/api/customers', `/api/customers/${f.custOrg}/contacts`]) {
      const r = await call(d.token, { method: 'GET', path })
      if (!(denied(r.status) || (Array.isArray(r.json) && r.json.length === 0))) bad.push(`driver GET ${path} -> ${show(r)}`)
    }
    for (const path of ['/api/drivers', '/api/customers', `/api/customers/${f.custOrg}/contacts`, '/api/vehicles']) {
      const r = await call(f.a.customer.token, { method: 'GET', path })
      if (!(denied(r.status) || (Array.isArray(r.json) && r.json.length === 0))) bad.push(`customer_viewer GET ${path} -> ${show(r)}`)
    }
    expect(bad.join('\n')).toBe('')
  })
  it('a driver cannot burn LLM spend via /api/extract-load (any authenticated session is accepted)', async () => {
    const r = await call(f.a.driver1.token, { method: 'POST', path: '/api/extract-load', body: { text: 'ab' } }) // short body: validation only, no LLM call
    // role gate would answer 403 before validation; 400 proves the request got past authz.
    expect(r.status, show(r)).toBe(403)
  })
})

describe('A3 cross-tenant access by id (org A owner vs org B objects)', () => {
  it('owner A gets 404/403 on org B ids across legacy and v1 routes', async () => {
    const ownerB = f.b.owner.user.userId
    const reqs: Req[] = [
      { method: 'PATCH', path: `/api/loads/${f.ids.loadB}`, body: { status: 'cancelled' } },
      { method: 'POST', path: `/api/loads/${f.ids.loadB}/send-documents`, body: { to: 'x@example.com' } },
      { method: 'POST', path: `/api/invoices/${f.ids.invoiceB}/send`, body: {} },
      { method: 'POST', path: `/api/invoices/${f.ids.invoiceB}/factor`, body: { factoring_company: 'aud' } },
      { method: 'PATCH', path: `/api/team/${ownerB}`, body: { role: 'dispatcher' } },
      { method: 'DELETE', path: `/api/team/${ownerB}` },
      { method: 'POST', path: `/api/customers/${f.orgB}/contacts`, body: { name: 'aud', email: 'aud@example.com' } },
      { method: 'PATCH', path: `/api/v1/invoices/${f.ids.invoiceB}`, body: { amount: 1 }, idem: true },
      { method: 'POST', path: `/api/v1/invoices/${f.ids.invoiceB}/mark-paid`, body: {}, idem: true },
      { method: 'POST', path: `/api/v1/loads/${f.ids.loadB}/milestones`, body: { expected_status: 'dispatched', new_status: 'delivered' }, idem: true },
      { method: 'GET', path: `/api/v1/loads/${f.ids.loadB}/documents?type=pod` },
      { method: 'POST', path: `/api/v1/loads/${f.ids.loadB}/fuel-stops`, body: { state: 'nv', gallons: 1, price_per_gallon: 1 }, idem: true },
      { method: 'POST', path: `/api/v1/loads/${f.ids.loadB}/problem-reports`, body: { reason: 'other' }, idem: true },
      { method: 'PUT', path: `/api/v1/loads/${f.ids.loadB}/location`, body: { latitude: 1, longitude: 1 }, idem: true },
      { method: 'PUT', path: `/api/v1/loads/${f.ids.loadB}/ifta-crossings/manual`, body: { rows: [{ state: 'NV', miles: 1 }] }, idem: true },
      { method: 'POST', path: `/api/v1/vehicles/${f.ids.vehicleB}/service-logs`, body: { service_type: 'oil', service_date: '2026-01-01' }, idem: true },
      { method: 'POST', path: '/api/driver-messages', body: { load_id: f.ids.loadB, body: 'x' } },
    ]
    const bad: string[] = []
    for (const r of reqs) {
      const res = await call(f.a.owner.token, r)
      // By design, not leaks (ADR/InvoiceService): the v1 invoice draft edit gives ONE answer (409) for missing,
      // foreign and non-draft alike, and send-documents validates its body before it looks anything up.
      // The data-unchanged assertions below are what prove nothing was touched.
      const byDesign = res.status === 409 || (r.path.endsWith('/send-documents') && res.status === 400)
      if (!denied(res.status) && !byDesign) bad.push(`${r.method} ${r.path} -> ${show(res)}`)
    }
    const { data: l } = await f.admin.from('loads').select('status, commodity').eq('id', f.ids.loadB).single()
    const { data: i } = await f.admin.from('invoices').select('status, amount').eq('id', f.ids.invoiceB).single()
    expect({ l, i: { status: i!.status, amount: Number(i!.amount) } }).toEqual({ l: { status: 'dispatched', commodity: null }, i: { status: 'sent', amount: 999 } })
    expect(bad.join('\n')).toBe('')
  })
  it('v1 /loads list for org A owner contains no org B load', async () => {
    const r = await call(f.a.owner.token, { method: 'GET', path: '/api/v1/loads' })
    expect(JSON.stringify(r.json)).not.toContain(String(f.ids.loadB) === '' ? 'x' : `"id":${f.ids.loadB},`)
  })
  it('within tenant: driver1 is refused on driver2\'s load across v1 commands', async () => {
    const id = f.ids.loadA2
    const reqs: Req[] = [
      { method: 'POST', path: `/api/v1/loads/${id}/milestones`, body: { expected_status: 'dispatched', new_status: 'delivered' }, idem: true },
      { method: 'GET', path: `/api/v1/loads/${id}/documents?type=pod` },
      { method: 'POST', path: `/api/v1/loads/${id}/fuel-stops`, body: { state: 'nv', gallons: 1, price_per_gallon: 1 }, idem: true },
      { method: 'POST', path: `/api/v1/loads/${id}/problem-reports`, body: { reason: 'other' }, idem: true },
      { method: 'PUT', path: `/api/v1/loads/${id}/location`, body: { latitude: 1, longitude: 1 }, idem: true },
      { method: 'PUT', path: `/api/v1/loads/${id}/ifta-crossings/manual`, body: { rows: [{ state: 'NV', miles: 1 }] }, idem: true },
      { method: 'POST', path: '/api/driver-messages', body: { load_id: id, body: 'x' } },
    ]
    const bad: string[] = []
    for (const r of reqs) { const res = await call(f.a.driver1.token, r); if (!denied(res.status)) bad.push(`${r.method} ${r.path} -> ${show(res)}`) }
    expect(bad.join('\n')).toBe('')
  })
  it('customer portal user is refused on every v1 command/read of the carrier\'s load', async () => {
    const id = f.ids.loadA1
    const reqs: Req[] = [
      { method: 'POST', path: `/api/v1/loads/${id}/milestones`, body: { expected_status: 'dispatched', new_status: 'delivered' }, idem: true },
      { method: 'GET', path: `/api/v1/loads/${id}/documents?type=pod` },
      { method: 'POST', path: `/api/v1/loads/${id}/fuel-stops`, body: { state: 'nv', gallons: 1, price_per_gallon: 1 }, idem: true },
      { method: 'POST', path: `/api/v1/loads/${id}/problem-reports`, body: { reason: 'other' }, idem: true },
      { method: 'PUT', path: `/api/v1/loads/${id}/location`, body: { latitude: 1, longitude: 1 }, idem: true },
      { method: 'POST', path: `/api/v1/loads/${id}/messages/read`, body: { message_ids: [1] }, idem: true },
      { method: 'POST', path: '/api/driver-messages', body: { load_id: id, body: 'x' } },
      { method: 'PATCH', path: `/api/v1/invoices/${f.ids.invoiceA}`, body: { amount: 1 }, idem: true },
    ]
    const bad: string[] = []
    for (const r of reqs) { const res = await call(f.a.customer.token, r); if (!denied(res.status) && res.status !== 405) bad.push(`${r.method} ${r.path} -> ${show(res)}`) }
    expect(bad.join('\n')).toBe('')
  })
  it('v1 /loads list as customer_viewer exposes neither rate nor foreign loads', async () => {
    const r = await call(f.a.customer.token, { method: 'GET', path: '/api/v1/loads' })
    expect(JSON.stringify(r.json), show(r)).not.toMatch(/"rate"\s*:\s*[1-9]/)
  })
  it('v1 /loads list as driver never returns rate', async () => {
    const r = await call(f.a.driver1.token, { method: 'GET', path: '/api/v1/loads?fields=rate' })
    expect(JSON.stringify(r.json), show(r)).not.toMatch(/"rate"\s*:\s*[1-9]/)
  })
})

describe('A4 /api/admin/* — only sx_* roles, and only the right ones', () => {
  const adm = (): Req[] => [
    { method: 'GET', path: '/api/admin/orgs' }, { method: 'GET', path: `/api/admin/orgs/${f.orgA}` },
    { method: 'GET', path: '/api/admin/audit' }, { method: 'GET', path: '/api/admin/billing' }, { method: 'GET', path: '/api/admin/flags' }, { method: 'GET', path: '/api/admin/pipeline' },
    { method: 'PATCH', path: `/api/admin/orgs/${f.orgA}/tier`, body: { tier: 'enterprise' } },
    { method: 'PATCH', path: `/api/admin/orgs/${f.orgA}/trial`, body: { days: 30 } },
    { method: 'PATCH', path: `/api/admin/orgs/${f.orgA}/grace-period`, body: { days: 30 } },
    { method: 'POST', path: `/api/admin/orgs/${f.orgA}/notes`, body: { body: 'pwn' } },
    { method: 'POST', path: `/api/admin/orgs/${f.orgA}/impersonate`, body: {} },
    { method: 'POST', path: '/api/admin/flags/override', body: { org_id: f.orgA, flag_key: 'x', enabled: true } },
    { method: 'PATCH', path: '/api/admin/flags', body: { key: 'x', enabled: true } },
  ]
  for (const who of ['a.owner', 'a.dispatcher', 'a.finance', 'a.driver1', 'a.customer'] as const) {
    it(`${who} (tenant role) gets 403 on ALL /api/admin routes`, async () => {
      const actor = f.a[who.split('.')[1] as keyof Fixture['a']]
      const bad: string[] = []
      for (const r of adm()) { const res = await call(actor.token, r); if (res.status !== 403) bad.push(`${r.method} ${r.path} -> ${show(res)}`) }
      expect(bad.join('\n')).toBe('')
    })
  }
  it('sx_support is refused billing/pipeline/tier/trial/grace/flag-override/flag-edit (sx_owner|sx_finance only)', async () => {
    const forbidden = adm().filter((r) => /billing|pipeline|\/tier|\/trial|grace-period|flags/.test(r.path) && r.method !== 'GET')
    const bad: string[] = []
    for (const r of forbidden) { const res = await call(f.sx.support.token, r); if (res.status !== 403) bad.push(`${r.method} ${r.path} -> ${show(res)}`) }
    expect(bad.join('\n')).toBe('')
  })
  it('sx_finance is refused flags (owner only) and impersonate (owner|support only)', async () => {
    const bad: string[] = []
    for (const r of adm().filter((x) => /flags|impersonate/.test(x.path) && x.method !== 'GET')) { const res = await call(f.sx.finance.token, r); if (res.status !== 403) bad.push(`${r.method} ${r.path} -> ${show(res)}`) }
    expect(bad.join('\n')).toBe('')
  })
  it('a tenant user cannot become sx via POST /api/onboarding {role:"sx_owner"} (self-serve signup path)', async () => {
    const email = `audit_ob_${Date.now()}@carrieros-test.dev`
    const { data: u } = await f.admin.auth.admin.createUser({ email, password: 'AuditPass123!x', email_confirm: true })
    const { createClient } = await import('@supabase/supabase-js')
    const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { data: s } = await c.auth.signInWithPassword({ email, password: 'AuditPass123!x' })
    const tok = s.session!.access_token
    const ob = await call(tok, { method: 'POST', path: '/api/onboarding', body: { company_name: `AuditOb ${Date.now()}`, state: 'TX', first_name: 'a', last_name: 'b', role: 'sx_owner', tier: 'enterprise' } })
    const { data: prof } = await f.admin.from('profiles').select('role, org_id').eq('id', u.user!.id).maybeSingle()
    const adminCall = await call(tok, { method: 'GET', path: '/api/admin/orgs' })
    // cleanup: profile -> auth user -> org rows created by onboarding
    const orgId = (ob.json as { org_id?: number } | null)?.org_id
    await f.admin.from('profiles').delete().eq('id', u.user!.id)
    await f.admin.auth.admin.deleteUser(u.user!.id)
    if (orgId) { await f.admin.from('carrier_details').delete().eq('org_id', orgId); await f.admin.from('org_sequences').delete().eq('org_id', orgId); await f.admin.from('organizations').delete().eq('id', orgId) }
    // Fixed by rejecting the role (400) rather than silently rewriting it; either way no elevated profile exists.
    expect(['owner', undefined], `onboarding ${show(ob)}`).toContain(prof?.role)
    expect(adminCall.status).toBe(403)
  })
  it('onboarding with role:"driver"/"finance" is not honoured either (role must be server-decided)', async () => {
    const email = `audit_ob2_${Date.now()}@carrieros-test.dev`
    const { data: u } = await f.admin.auth.admin.createUser({ email, password: 'AuditPass123!x', email_confirm: true })
    const { createClient } = await import('@supabase/supabase-js')
    const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { data: s } = await c.auth.signInWithPassword({ email, password: 'AuditPass123!x' })
    const ob = await call(s.session!.access_token, { method: 'POST', path: '/api/onboarding', body: { company_name: `AuditOb2 ${Date.now()}`, state: 'TX', first_name: 'a', last_name: 'b', role: 'customer_admin' } })
    const { data: prof } = await f.admin.from('profiles').select('role').eq('id', u.user!.id).maybeSingle()
    const orgId = (ob.json as { org_id?: number } | null)?.org_id
    await f.admin.from('profiles').delete().eq('id', u.user!.id)
    await f.admin.auth.admin.deleteUser(u.user!.id)
    if (orgId) { await f.admin.from('carrier_details').delete().eq('org_id', orgId); await f.admin.from('org_sequences').delete().eq('org_id', orgId); await f.admin.from('organizations').delete().eq('id', orgId) }
    expect(['owner', undefined]).toContain(prof?.role)
  })
})

describe('A5 unauthenticated-by-design endpoints', () => {
  it('cron: no/incorrect secret is refused, and secret is not accepted in the query string', async () => {
    expect((await call(null, { method: 'POST', path: '/api/cron/send-reminders' })).status).toBe(401)
    expect((await call('wrong', { method: 'POST', path: '/api/cron/send-reminders' })).status).toBe(401)
    const q = await call(null, { method: 'POST', path: '/api/cron/send-reminders?token=wrong' })
    expect(q.status).toBe(401)
  })
  it('intake webhook: missing/incorrect secret refused', async () => {
    const r = await fetch(`${BASE()}/api/intake/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-intake-webhook-secret': 'nope' }, body: JSON.stringify({ to: `x@y`, text: 'x'.repeat(30) }) })
    expect([403, 500]).toContain(r.status)
    const r2 = await fetch(`${BASE()}/api/intake/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    expect([403, 500]).toContain(r2.status)
  })
  it('invoice tracking pixel: an unauthenticated caller cannot flip another tenant\'s invoice to "opened"', async () => {
    await f.admin.from('invoices').update({ opened_at: null }).eq('id', f.ids.invoiceB)
    await fetch(`${BASE()}/api/invoices/${f.ids.invoiceB}/track`)
    const { data } = await f.admin.from('invoices').select('opened_at').eq('id', f.ids.invoiceB).single()
    expect(data!.opened_at, 'anonymous GET wrote opened_at on a foreign invoice by sequential id').toBeNull()
  })
  it('CORS: API reflects any Origin with Access-Control-Allow-Origin (Bearer-only so not credentialed-cookie CSRF, but review)', async () => {
    const r = await fetch(`${BASE()}/api/v1/me`, { headers: { Origin: 'https://evil.example' } })
    expect(r.headers.get('access-control-allow-origin')).not.toBe('https://evil.example')
  })
})

describe('A6 cross-tenant reference injection (write a foreign id into your own rows)', () => {
  it('owner A cannot create a customer_contact under an org that is not their customer, nor invite it into that org', async () => {
    const email = `aud_intruder_${Date.now()}@carrieros-test.dev`
    const mk = await call(f.a.owner.token, { method: 'POST', path: `/api/customers/${f.orgB}/contacts`, body: { name: 'Intruder Aud', email } })
    let invite: { status: number; json: unknown } | null = null
    if (mk.status === 201) {
      const cid = (mk.json as { id: number }).id
      invite = await call(f.a.owner.token, { method: 'POST', path: `/api/customers/${f.orgB}/contacts/${cid}/invite`, body: { role: 'customer_admin' } })
    }
    const { data: prof } = await f.admin.from('profiles').select('id, org_id, role').eq('org_id', f.orgB).like('first_name', 'Intruder%')
    let readBack = ''
    if (prof?.length) {
      await f.admin.from('documents').insert({ carrier_org_id: f.orgB, load_id: f.ids.loadB, storage_path: 'audit/b.pdf', type: 'bol', uploaded_by: f.b.owner.user.userId })
      await f.admin.from('driver_documents').insert({ carrier_org_id: f.orgB, driver_id: f.ids.driverB, doc_type: 'cdl_scan', storage_path: 'audit/bcdl.pdf', uploaded_by: f.b.owner.user.userId })
      await f.admin.from('load_expenses').insert({ carrier_org_id: f.orgB, load_id: f.ids.loadB, expense_type: 'fuel', amount: 5, logged_by: f.b.owner.user.userId })
      // prove impact: give the intruder a password, sign in, read org B tables
      await f.admin.auth.admin.updateUserById(prof[0].id, { password: 'AuditPass123!x', email_confirm: true })
      const { data: au } = await f.admin.auth.admin.getUserById(prof[0].id)
      const { createClient } = await import('@supabase/supabase-js')
      const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      const si = await c.auth.signInWithPassword({ email: au.user!.email!, password: 'AuditPass123!x' })
      const counts: Record<string, number> = {}
      for (const t of ['vehicles', 'drivers', 'driver_documents', 'documents', 'load_expenses', 'loads', 'invoices', 'profiles', 'service_logs', 'fuel_stops', 'exception_events']) {
        counts[t] = ((await c.from(t).select('id').eq(t === 'profiles' ? 'org_id' : 'carrier_org_id' as never, f.orgB)).data ?? []).length
      }
      readBack = JSON.stringify({ signedIn: !si.error, ...counts })
    }
    expect({ create: mk.status, invite: invite?.status ?? null, intruderProfiles: prof?.length ?? 0, readBack }).toEqual({ create: 404, invite: null, intruderProfiles: 0, readBack: '' })
  })
  it('owner A cannot point their load at a foreign-org driver / vehicle / customer (FK carries no tenant check)', async () => {
    const r = await call(f.a.owner.token, { method: 'PATCH', path: `/api/loads/${f.ids.loadA2}`, body: { driver_id: f.ids.driverB, vehicle_id: f.ids.vehicleB } })
    const { data } = await f.admin.from('loads').select('driver_id, vehicle_id').eq('id', f.ids.loadA2).single()
    const seen = ((await f.b.driver.client.from('loads').select('id').eq('id', f.ids.loadA2)).data ?? []).length
    expect({ patch: r.status, driver: Number(data!.driver_id), vehicle: data!.vehicle_id == null ? null : Number(data!.vehicle_id), driverBSeesLoadA: seen }).toEqual({ patch: 400, driver: f.ids.driverA2, vehicle: null, driverBSeesLoadA: 0 })
  })
  it('owner A cannot set customer_org_id of own load to org B via PostgREST (org B members would then read it incl. rate)', async () => {
    await f.a.owner.client.from('loads').update({ customer_org_id: f.orgB }).eq('id', f.ids.loadA2)
    const seenByB = ((await f.b.owner.client.from('loads').select('id, rate').eq('id', f.ids.loadA2)).data ?? []).length
    expect(seenByB).toBe(0)
  })
})

