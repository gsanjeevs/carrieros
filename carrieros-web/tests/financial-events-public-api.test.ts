// tests/financial-events-public-api.test.ts
// GET /api/public/v1/financial-events (T19 readiness layer) — same OAuth2
// client-credentials pattern as tests/security-public-api.test.ts. Covers:
// auth gating, response shape, cursor pagination resuming without re-serving
// already-seen events, and category mapping for one case of each of the
// three source types (invoice, driver settlement, load expense).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, type TestOrg, type TestUser } from './helpers'

const APP = process.env.TEST_APP_URL ?? 'http://localhost:3000'

const api = (token: string | null, method: string, path: string) =>
  fetch(`${APP}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} })

async function createOAuthClient(admin: SupabaseClient<Database>, orgId: number, name: string) {
  const clientId = `pub_client_fin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const clientSecret = `pub_secret_fin_${Math.random().toString(36).slice(2, 15)}`
  const hash = await bcrypt.hash(clientSecret, 4)
  const { error } = await admin.from('oauth_clients').insert({ org_id: orgId, client_id: clientId, client_secret_hash: hash, name })
  if (error) throw new Error(`createOAuthClient: ${error.message}`)
  return { clientId, clientSecret }
}

async function issueAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${APP}/api/public/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  })
  if (res.status !== 200) throw new Error(`issueAccessToken failed: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

const admin = adminClient()

describe('GET /api/public/v1/financial-events', () => {
  let org: TestOrg
  let ownerClient: SupabaseClient<Database>
  let owner: TestUser
  let token: string
  let loadId: number

  beforeAll(async () => {
    org = await createTestOrg(admin, 'carrier', { tier: 'growth' })
    owner = await createTestUser(admin, org.orgId, 'owner')
    ownerClient = (await signInAs(owner)).client

    const { data: loadRow, error } = await admin
      .from('loads')
      .insert({ carrier_org_id: org.orgId, load_number: `FINPUB-${Date.now()}`, status: 'delivered', rate: 1234 })
      .select('id')
      .single()
    if (error || !loadRow) throw new Error(`load setup: ${error?.message}`)
    loadId = Number(loadRow.id)

    // One event of each source type, via the same RPCs the app's own write
    // paths call — not a direct outbox_events insert, so this exercises the
    // real instrumented path.
    await ownerClient.rpc('create_invoice_command' as never, {
      p_load_id: loadId,
      p_customer_org_id: null,
      p_invoice_number: `FINPUB-INV-${loadId}`,
      p_amount: 1234,
      p_due_date: '2026-12-01',
      p_payment_method: 'other',
      p_factoring_company: null,
      p_advance_load_status: true,
      p_correlation_id: 'test-corr',
      p_idempotency_key: `test:pub:invoice:${loadId}`,
    } as never)

    const driverUser = await createTestUser(admin, org.orgId, 'driver')
    const { data: driverRow } = await admin
      .from('drivers')
      .insert({
        carrier_org_id: org.orgId,
        profile_id: driverUser.userId,
        driver_number: `FINPUB-${Date.now()}`,
        invite_status: 'accepted',
        settlement_type: 'flat_per_load',
        settlement_rate: 300,
      })
      .select('id')
      .single()
    await ownerClient.rpc('create_driver_settlement_command' as never, {
      p_driver_id: Number(driverRow!.id),
      p_pay_method: 'flat_per_load',
      p_rate_value: 300,
      p_gross_revenue: 1234,
      p_net_pay: 300,
      p_loads_count: 1,
      p_period_start: '2026-08-01',
      p_period_end: '2026-08-15',
      p_correlation_id: 'test-corr',
      p_idempotency_key: `test:pub:settlement:${loadId}`,
    } as never)

    await ownerClient.rpc('record_load_expense_command' as never, {
      p_load_id: loadId,
      p_expense_type: 'lumper',
      p_amount: 55,
      p_note: null,
      p_correlation_id: 'test-corr',
      p_idempotency_key: `test:pub:expense:${loadId}`,
    } as never)

    const oauth = await createOAuthClient(admin, org.orgId, 'Financial Events Test Client')
    token = await issueAccessToken(oauth.clientId, oauth.clientSecret)
  }, 60_000)

  afterAll(async () => {
    await cleanupTestOrg(admin, org.orgId)
  })

  it('requires a bearer token', async () => {
    const res = await api(null, 'GET', '/api/public/v1/financial-events')
    expect(res.status).toBe(401)
  })

  it('returns all three event categories with resolved currency and reference data', async () => {
    const res = await api(token, 'GET', '/api/public/v1/financial-events?limit=500')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.events.length).toBeGreaterThanOrEqual(3)

    const byType = Object.fromEntries(body.events.map((e: { event_type: string }) => [e.event_type, e]))
    expect(byType.InvoiceCreated.category).toBe('revenue:freight')
    expect(byType.InvoiceCreated.currency).toMatch(/^[A-Z]{3}$/)
    expect(byType.InvoiceCreated.reference.load_id).toBe(loadId)
    expect(byType.InvoiceCreated.reference.invoice_number).toContain('FINPUB-INV')

    expect(byType.DriverSettlementCreated.category).toBe('expense:driver_pay')
    expect(byType.DriverSettlementCreated.amount).toBe(300)

    expect(byType.LoadExpenseRecorded.category).toBe('expense:lumper')
    expect(byType.LoadExpenseRecorded.amount).toBe(55)

    // Stable external id present on every event, usable as a dedupe key.
    for (const e of body.events as { id: string }[]) {
      expect(typeof e.id).toBe('string')
      expect(e.id.length).toBeGreaterThan(0)
    }
  })

  it('paginates by cursor without re-serving already-seen events', async () => {
    const firstPage = await api(token, 'GET', '/api/public/v1/financial-events?limit=1')
    expect(firstPage.status).toBe(200)
    const firstBody = await firstPage.json()
    expect(firstBody.events.length).toBe(1)
    expect(firstBody.next_cursor).toBe(firstBody.events[0].id)

    const secondPage = await api(token, 'GET', `/api/public/v1/financial-events?limit=1&cursor=${firstBody.next_cursor}`)
    const secondBody = await secondPage.json()
    expect(secondBody.events.length).toBe(1)
    expect(secondBody.events[0].id).not.toBe(firstBody.events[0].id)
    // ids are the outbox table's own bigserial — strictly increasing.
    expect(Number(secondBody.events[0].id)).toBeGreaterThan(Number(firstBody.events[0].id))
  })

  it('a short page (fewer than limit) reports next_cursor: null — caller has caught up', async () => {
    const res = await api(token, 'GET', '/api/public/v1/financial-events?limit=500')
    const body = await res.json()
    expect(body.next_cursor).toBeNull()
  })
})
