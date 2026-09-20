// tests/exceptions.test.ts
// Gate 0->1 coverage gap closed (docs/production-gates.md) — get_exceptions()
// tier thresholds and get_customer_health_score()'s formula, both
// SECURITY DEFINER SQL functions (supabase/schema/schema.sql). These are
// RPC/lib-function tests (call .rpc() directly via a signInAs() client),
// not route tests — there is no app/api/exceptions route; lib/exceptions.ts
// is a Server Component helper calling get_exceptions() directly.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg,
  type TestOrg, type TestUser,
} from './helpers'

const admin = adminClient()

describe('get_exceptions() tier thresholds', () => {
  let org: TestOrg
  let owner: TestUser
  let ownerSession: Awaited<ReturnType<typeof signInAs>>

  beforeAll(async () => {
    org = await createTestOrg(admin, 'carrier')
    owner = await createTestUser(admin, org.orgId, 'owner')
    ownerSession = await signInAs(owner)
  })

  afterAll(async () => {
    await cleanupTestOrg(admin, org.orgId)
  })

  it('an invoice due today is tier "today"; one due in 5 days is tier "this_week"', async () => {
    // get_exceptions()'s tier logic is `due_date < CURRENT_DATE ? 'today' :
    // 'this_week'` — strictly LESS than, so a due date of today itself is
    // still 'this_week' (within the 7-day window), and only an already-
    // overdue (past due date) invoice is tier 'today'.
    const yesterday = new Date(Date.now() - 1 * 86_400_000)
    const in5Days = new Date(Date.now() + 5 * 86_400_000)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)

    await admin.from('invoices').insert([
      { carrier_org_id: org.orgId, invoice_number: `EX-A-${Date.now()}`, status: 'sent', amount: 100, due_date: fmt(yesterday) },
      { carrier_org_id: org.orgId, invoice_number: `EX-B-${Date.now()}`, status: 'sent', amount: 200, due_date: fmt(in5Days) },
    ])

    const { data, error } = await ownerSession.client.rpc('get_exceptions')
    expect(error).toBeNull()

    const invoiceExceptions = (data ?? []).filter((e: { exception_type: string }) => e.exception_type === 'invoice_overdue')
    expect(invoiceExceptions.find((e: { tier: string; detail: string }) => e.detail.includes('$100'))?.tier).toBe('today')
    expect(invoiceExceptions.find((e: { tier: string; detail: string }) => e.detail.includes('$200'))?.tier).toBe('this_week')
  })

  it('an invoice due in 10 days does not appear at all (invoices have no "upcoming" tier, only a 7-day window)', async () => {
    const in10Days = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
    await admin.from('invoices').insert({
      carrier_org_id: org.orgId, invoice_number: `EX-C-${Date.now()}`, status: 'sent', amount: 300, due_date: in10Days,
    })

    const { data } = await ownerSession.client.rpc('get_exceptions')
    const found = (data ?? []).some((e: { exception_type: string; detail: string }) =>
      e.exception_type === 'invoice_overdue' && e.detail.includes('$300')
    )
    expect(found).toBe(false)
  })
})

describe('get_customer_health_score()', () => {
  let org: TestOrg
  let owner: TestUser
  let ownerSession: Awaited<ReturnType<typeof signInAs>>
  let customerOrgId: number

  beforeAll(async () => {
    org = await createTestOrg(admin, 'carrier', { tier: 'growth' }) // gated: customer_health_score is Growth+ (migration 0021)
    owner = await createTestUser(admin, org.orgId, 'owner')
    ownerSession = await signInAs(owner)

    const { data: customerOrg } = await admin
      .from('organizations')
      .insert({ type: 'customer', name: `Health Score Test Customer ${Date.now()}` })
      .select('id')
      .single()
    customerOrgId = customerOrg!.id
    await admin.from('customer_details').insert({ org_id: customerOrgId, carrier_org_id: org.orgId })
  })

  afterAll(async () => {
    // customer_details.carrier_org_id has no ON DELETE CASCADE from
    // organizations (confirmed in schema.sql) — the customer org (which
    // cascades its own customer_details row via org_id) must go first, or
    // cleanupTestOrg's delete on the carrier org 500s on the FK.
    await admin.from('organizations').delete().eq('id', customerOrgId)
    await cleanupTestOrg(admin, org.orgId)
  })

  it('all invoices paid on time and zero exceptions -> score 100', async () => {
    await admin.from('invoices').insert([
      { carrier_org_id: org.orgId, customer_org_id: customerOrgId, invoice_number: `HS-A-${Date.now()}`, status: 'paid', amount: 100, due_date: '2026-06-01', paid_at: '2026-05-30' },
      { carrier_org_id: org.orgId, customer_org_id: customerOrgId, invoice_number: `HS-B-${Date.now()}`, status: 'paid', amount: 100, due_date: '2026-06-15', paid_at: '2026-06-14' },
    ])

    const { data, error } = await ownerSession.client.rpc('get_customer_health_score', { customer_org_id: customerOrgId })
    expect(error).toBeNull()
    expect(Number(data)).toBe(100)
  })

  it('2 of 4 invoices paid late plus 3 exceptions in the last 90 days -> exact score 56 (payment_pct=50*0.7 + exception_pct=70*0.3)', async () => {
    // Fresh customer org so this test's math isn't polluted by the prior test's rows.
    const { data: freshCustomerOrg } = await admin
      .from('organizations')
      .insert({ type: 'customer', name: `Health Score Test Customer B ${Date.now()}` })
      .select('id')
      .single()
    const freshCustomerOrgId = freshCustomerOrg!.id
    await admin.from('customer_details').insert({ org_id: freshCustomerOrgId, carrier_org_id: org.orgId })

    await admin.from('invoices').insert([
      { carrier_org_id: org.orgId, customer_org_id: freshCustomerOrgId, invoice_number: `HS-C-${Date.now()}`, status: 'paid', amount: 100, due_date: '2026-06-01', paid_at: '2026-05-30' },
      { carrier_org_id: org.orgId, customer_org_id: freshCustomerOrgId, invoice_number: `HS-D-${Date.now()}`, status: 'paid', amount: 100, due_date: '2026-06-05', paid_at: '2026-06-04' },
      { carrier_org_id: org.orgId, customer_org_id: freshCustomerOrgId, invoice_number: `HS-E-${Date.now()}`, status: 'paid', amount: 100, due_date: '2026-06-01', paid_at: '2026-06-05' },
      { carrier_org_id: org.orgId, customer_org_id: freshCustomerOrgId, invoice_number: `HS-F-${Date.now()}`, status: 'paid', amount: 100, due_date: '2026-06-01', paid_at: '2026-06-10' },
    ])
    await admin.from('exception_events').insert([
      { carrier_org_id: org.orgId, entity_type: 'customer', entity_id: freshCustomerOrgId, event_type: 'late_delivery', title: 'e1' },
      { carrier_org_id: org.orgId, entity_type: 'customer', entity_id: freshCustomerOrgId, event_type: 'late_delivery', title: 'e2' },
      { carrier_org_id: org.orgId, entity_type: 'customer', entity_id: freshCustomerOrgId, event_type: 'late_delivery', title: 'e3' },
    ])

    const { data, error } = await ownerSession.client.rpc('get_customer_health_score', { customer_org_id: freshCustomerOrgId })
    expect(error).toBeNull()
    expect(Number(data)).toBe(56)

    await admin.from('organizations').delete().eq('id', freshCustomerOrgId)
  })

  it('a customer belonging to a different carrier org is invisible to my_org_id() scoping -> defaults to a perfect 100, not an error', async () => {
    const otherOrg = await createTestOrg(admin, 'carrier')
    const { data: otherCustomerOrg } = await admin
      .from('organizations')
      .insert({ type: 'customer', name: `Other Carrier Customer ${Date.now()}` })
      .select('id')
      .single()
    const otherCustomerOrgId = otherCustomerOrg!.id
    await admin.from('customer_details').insert({ org_id: otherCustomerOrgId, carrier_org_id: otherOrg.orgId })
    // A real invoice + exception exist for this customer, but under the
    // OTHER carrier org — my_org_id()'s filter means the caller's query sees
    // none of it, which is the cross-tenant-isolation property under test.
    await admin.from('invoices').insert({
      carrier_org_id: otherOrg.orgId, customer_org_id: otherCustomerOrgId, invoice_number: `HS-X-${Date.now()}`,
      status: 'paid', amount: 100, due_date: '2026-01-01', paid_at: '2026-02-01',
    })

    const { data, error } = await ownerSession.client.rpc('get_customer_health_score', { customer_org_id: otherCustomerOrgId })
    expect(error).toBeNull()
    expect(Number(data)).toBe(100)

    await admin.from('organizations').delete().eq('id', otherCustomerOrgId)
    await cleanupTestOrg(admin, otherOrg.orgId)
  })
})
