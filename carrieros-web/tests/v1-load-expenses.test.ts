// POST /api/v1/loads/{id}/expenses — first write path for load_expenses (T19
// readiness layer). Same shape as tests/v1-milestones.test.ts: transport-level
// auth/tier/idempotency behavior, since the SQL underneath (migration 0033)
// bypasses RLS and is already covered at the DB level in
// tests/financial-events-command.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch, type TestOrg } from './helpers'

const admin = adminClient()
let orgGrowth: TestOrg
let orgStarter: TestOrg
let ownerToken: string
let driverToken: string
let starterOwnerToken: string

let n = 0
const key = () => `test-exp-key-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`

async function makeLoad(orgId: number) {
  const { data, error } = await admin
    .from('loads')
    .insert({ carrier_org_id: orgId, load_number: `EXP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, status: 'dispatched' })
    .select('id')
    .single()
  if (error || !data) throw new Error(`makeLoad: ${error?.message}`)
  return Number(data.id)
}

function logExpense(token: string, loadId: number, body: Record<string, unknown>, idem: string | null = key()) {
  return apiFetch(`/api/v1/loads/${loadId}/expenses`, token, {
    method: 'POST',
    headers: idem ? { 'Idempotency-Key': idem } : {},
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  orgGrowth = await createTestOrg(admin, 'carrier', { tier: 'growth' })
  orgStarter = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  const owner = await createTestUser(admin, orgGrowth.orgId, 'owner')
  const driver = await createTestUser(admin, orgGrowth.orgId, 'driver')
  const starterOwner = await createTestUser(admin, orgStarter.orgId, 'owner')
  ownerToken = (await signInAs(owner)).accessToken
  driverToken = (await signInAs(driver)).accessToken
  starterOwnerToken = (await signInAs(starterOwner)).accessToken
}, 60_000)

afterAll(async () => {
  await cleanupTestOrg(admin, orgGrowth.orgId)
  await cleanupTestOrg(admin, orgStarter.orgId)
})

describe('POST /api/v1/loads/{id}/expenses', () => {
  it('an owner on a Growth+ org can log an expense', async () => {
    const loadId = await makeLoad(orgGrowth.orgId)
    const res = await logExpense(ownerToken, loadId, { expense_type: 'toll', amount: 12.5, note: 'bridge toll' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.amount).toBe(12.5)

    const { data } = await admin.from('load_expenses').select('expense_type, amount').eq('id', body.id).single()
    expect(data?.expense_type).toBe('toll')
  })

  it('rejects an unknown expense_type with 400 VALIDATION_ERROR', async () => {
    const loadId = await makeLoad(orgGrowth.orgId)
    const res = await logExpense(ownerToken, loadId, { expense_type: 'bribery', amount: 5 })
    expect(res.status).toBe(400)
  })

  it('requires an Idempotency-Key', async () => {
    const loadId = await makeLoad(orgGrowth.orgId)
    const res = await logExpense(ownerToken, loadId, { expense_type: 'toll', amount: 5 }, null)
    expect(res.status).toBe(400)
  })

  it('replaying the same Idempotency-Key does not create a second expense', async () => {
    const loadId = await makeLoad(orgGrowth.orgId)
    const idem = key()
    const first = await logExpense(ownerToken, loadId, { expense_type: 'scale', amount: 8 }, idem)
    expect(first.status).toBe(200)
    const second = await logExpense(ownerToken, loadId, { expense_type: 'scale', amount: 8 }, idem)
    expect(second.status).toBe(200)
    const { count } = await admin.from('load_expenses').select('id', { count: 'exact', head: true }).eq('load_id', loadId)
    expect(count).toBe(1)
  })

  it('a driver cannot log an expense (role gate matches owner_solo_dispatcher_load_expenses_all)', async () => {
    const loadId = await makeLoad(orgGrowth.orgId)
    const res = await logExpense(driverToken, loadId, { expense_type: 'toll', amount: 5 })
    expect(res.status).toBe(403)
  })

  it('rejects a Starter-tier org with 402 TIER_UPGRADE_REQUIRED', async () => {
    const loadId = await makeLoad(orgStarter.orgId)
    const res = await logExpense(starterOwnerToken, loadId, { expense_type: 'toll', amount: 5 })
    expect(res.status).toBe(402)
  })

  it('requires authentication', async () => {
    const loadId = await makeLoad(orgGrowth.orgId)
    const res = await fetch(`${process.env.TEST_APP_URL ?? 'http://localhost:3000'}/api/v1/loads/${loadId}/expenses`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expense_type: 'toll', amount: 5 }),
    })
    expect(res.status).toBe(401)
  })
})
