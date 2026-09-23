// PATCH /api/v1/invoices/{id} and POST /api/v1/invoices/{id}/mark-paid.
// Mark-paid used to be two separate writes from the phone (invoice, then load); the
// properties here: it is atomic, idempotent, scoped to the caller's org, and only
// roles that manage invoices may do it. Editing is draft-only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch, type TestOrg } from './helpers'

const admin = adminClient()
let orgA: TestOrg
let orgB: TestOrg
let ownerToken: string
let financeToken: string
let dispatcherToken: string
let driverToken: string
let otherOwnerToken: string

let n = 0
async function makeInvoice(orgId: number, status: string, withLoad = true) {
  let loadId: number | null = null
  if (withLoad) {
    const { data } = await admin.from('loads').insert({ carrier_org_id: orgId, load_number: `INV-L-${Date.now()}-${++n}`, status: 'invoiced' }).select('id').single()
    loadId = Number(data!.id)
  }
  const { data, error } = await admin
    .from('invoices')
    .insert({ carrier_org_id: orgId, invoice_number: `INV-${Date.now()}-${++n}`, amount: 1000, status, load_id: loadId })
    .select('id')
    .single()
  if (error || !data) throw new Error(`makeInvoice: ${error?.message}`)
  return { id: Number(data.id), loadId }
}
const call = async (token: string, method: string, path: string, body?: unknown) => {
  const res = await apiFetch(path, token, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { res, json: await res.json() }
}

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier')
  orgB = await createTestOrg(admin, 'carrier')
  const owner = await createTestUser(admin, orgA.orgId, 'owner')
  const finance = await createTestUser(admin, orgA.orgId, 'finance')
  const dispatcher = await createTestUser(admin, orgA.orgId, 'dispatcher')
  const driver = await createTestUser(admin, orgA.orgId, 'driver')
  const otherOwner = await createTestUser(admin, orgB.orgId, 'owner')
  ownerToken = (await signInAs(owner)).accessToken
  financeToken = (await signInAs(finance)).accessToken
  dispatcherToken = (await signInAs(dispatcher)).accessToken
  driverToken = (await signInAs(driver)).accessToken
  otherOwnerToken = (await signInAs(otherOwner)).accessToken
})

afterAll(async () => {
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
})

describe('PATCH /api/v1/invoices/{id} (draft edit)', () => {
  it('owner and finance edit a draft', async () => {
    const inv = await makeInvoice(orgA.orgId, 'draft')
    const a = await call(ownerToken, 'PATCH', `/api/v1/invoices/${inv.id}`, { amount: 1234.567, due_date: '2026-12-31', notes: '  net 30  ' })
    expect(a.res.status).toBe(200)
    const { data } = await admin.from('invoices').select('amount, due_date, notes').eq('id', inv.id).single()
    expect(data).toEqual({ amount: 1234.57, due_date: '2026-12-31', notes: 'net 30' })
    expect((await call(financeToken, 'PATCH', `/api/v1/invoices/${inv.id}`, { amount: 1500 })).res.status).toBe(200)
  })

  it('a SENT invoice is immutable here (409) and unchanged', async () => {
    const inv = await makeInvoice(orgA.orgId, 'sent')
    const { res, json } = await call(ownerToken, 'PATCH', `/api/v1/invoices/${inv.id}`, { amount: 5 })
    expect(res.status).toBe(409)
    expect(json.error_code).toBe('VERSION_CONFLICT')
    expect((await admin.from('invoices').select('amount').eq('id', inv.id).single()).data!.amount).toBe(1000)
  })

  it.each([
    ['zero amount', { amount: 0 }],
    ['negative amount', { amount: -5 }],
    ['bad date', { amount: 5, due_date: '12/31/2026' }],
  ])('rejects %s with 400', async (_l, body) => {
    const inv = await makeInvoice(orgA.orgId, 'draft')
    expect((await call(ownerToken, 'PATCH', `/api/v1/invoices/${inv.id}`, body)).res.status).toBe(400)
  })

  it('dispatcher and driver are refused (403); another org sees 409 not-a-draft and nothing changes', async () => {
    const inv = await makeInvoice(orgA.orgId, 'draft')
    expect((await call(dispatcherToken, 'PATCH', `/api/v1/invoices/${inv.id}`, { amount: 5 })).res.status).toBe(403)
    expect((await call(driverToken, 'PATCH', `/api/v1/invoices/${inv.id}`, { amount: 5 })).res.status).toBe(403)
    expect((await call(otherOwnerToken, 'PATCH', `/api/v1/invoices/${inv.id}`, { amount: 5 })).res.status).toBe(409)
    expect((await admin.from('invoices').select('amount').eq('id', inv.id).single()).data!.amount).toBe(1000)
  })
})

describe('POST /api/v1/invoices/{id}/mark-paid', () => {
  it('marks the invoice AND its load paid together', async () => {
    const inv = await makeInvoice(orgA.orgId, 'sent')
    const { res, json } = await call(ownerToken, 'POST', `/api/v1/invoices/${inv.id}/mark-paid`)
    expect(res.status).toBe(200)
    expect(json).toEqual({ outcome: 'APPLIED', invoice_id: inv.id })
    const { data: i } = await admin.from('invoices').select('status, paid_at').eq('id', inv.id).single()
    expect(i!.status).toBe('paid')
    expect(i!.paid_at).toBeTruthy()
    expect((await admin.from('loads').select('status').eq('id', inv.loadId!).single()).data!.status).toBe('paid')
  })

  it('is idempotent: the second call reports ALREADY_PAID and does not move paid_at', async () => {
    const inv = await makeInvoice(orgA.orgId, 'overdue')
    await call(financeToken, 'POST', `/api/v1/invoices/${inv.id}/mark-paid`)
    const first = (await admin.from('invoices').select('paid_at').eq('id', inv.id).single()).data!.paid_at
    const again = await call(financeToken, 'POST', `/api/v1/invoices/${inv.id}/mark-paid`)
    expect(again.json.outcome).toBe('ALREADY_PAID')
    expect((await admin.from('invoices').select('paid_at').eq('id', inv.id).single()).data!.paid_at).toBe(first)
  })

  it('works for an invoice with no load', async () => {
    const inv = await makeInvoice(orgA.orgId, 'sent', false)
    expect((await call(ownerToken, 'POST', `/api/v1/invoices/${inv.id}/mark-paid`)).res.status).toBe(200)
  })

  it('refuses dispatcher/driver (403); another org gets 404 and nothing changes', async () => {
    const inv = await makeInvoice(orgA.orgId, 'sent')
    expect((await call(dispatcherToken, 'POST', `/api/v1/invoices/${inv.id}/mark-paid`)).res.status).toBe(403)
    expect((await call(driverToken, 'POST', `/api/v1/invoices/${inv.id}/mark-paid`)).res.status).toBe(403)
    expect((await call(otherOwnerToken, 'POST', `/api/v1/invoices/${inv.id}/mark-paid`)).res.status).toBe(404)
    expect((await admin.from('invoices').select('status').eq('id', inv.id).single()).data!.status).toBe('sent')
    expect((await admin.from('loads').select('status').eq('id', inv.loadId!).single()).data!.status).toBe('invoiced')
  })

  it('requires authentication', async () => {
    const res = await fetch(`${process.env.TEST_APP_URL ?? 'http://localhost:3000'}/api/v1/invoices/1/mark-paid`, { method: 'POST' })
    expect(res.status).toBe(401)
  })
})
