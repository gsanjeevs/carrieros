// tests/admin-error-log.test.ts — Debug/Error Log viewer (app_error_log, migration
// 0038): logError() actually inserts a row, GET /api/v1/admin/error-log returns it
// with correct filtering/pagination for a ShipmentX admin, and a non-admin
// (including a carrier's own owner) gets 403.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg } from './helpers'
import { logError } from '../lib/observability'

const APP = process.env.TEST_APP_URL ?? 'http://localhost:3000'
const admin = adminClient()
let platformOrg: number, carrier: number
let sxOwnerToken: string, carrierOwnerToken: string

const call = (token: string, query = '') =>
  fetch(`${APP}/api/v1/admin/error-log${query}`, { headers: { Authorization: `Bearer ${token}` } })

beforeAll(async () => {
  platformOrg = (await createTestOrg(admin, 'carrier')).orgId
  await admin.from('organizations').update({ type: 'platform' }).eq('id', platformOrg)
  carrier = (await createTestOrg(admin, 'carrier')).orgId
  sxOwnerToken = (await signInAs(await createTestUser(admin, platformOrg, 'sx_owner'))).accessToken
  carrierOwnerToken = (await signInAs(await createTestUser(admin, carrier, 'owner'))).accessToken
}, 60_000)

afterAll(async () => {
  await admin.from('app_error_log').delete().eq('org_id', carrier)
  await cleanupTestOrg(admin, carrier)
  await cleanupTestOrg(admin, platformOrg)
})

describe('app_error_log write path (logError)', () => {
  it('a logError() call inserts a best-effort row into app_error_log', async () => {
    logError(
      { route: 'test/error-log-route', orgId: carrier, userId: undefined },
      new Error('boom: something failed'),
      { status: 500, failureMode: 'db_timeout' }
    )
    // Fire-and-forget insert -- give it a moment to land.
    await new Promise((r) => setTimeout(r, 500))

    const { data } = await admin
      .from('app_error_log')
      .select('route, message, org_id, context')
      .eq('route', 'test/error-log-route')
      .eq('org_id', carrier)
      .order('created_at', { ascending: false })
      .limit(1)

    expect(data?.[0]?.message).toContain('boom: something failed')
    expect(data?.[0]?.org_id).toBe(carrier)
    expect(data?.[0]?.context).toMatchObject({ status: 500, failureMode: 'db_timeout' })
  })

  it('never persists sensitive-looking keys in context', async () => {
    logError(
      { route: 'test/error-log-secret-route', orgId: carrier },
      new Error('leak check'),
      { status: 401, api_key: 'sk-should-not-be-stored', safe_field: 'ok' }
    )
    await new Promise((r) => setTimeout(r, 500))

    const { data } = await admin
      .from('app_error_log')
      .select('context')
      .eq('route', 'test/error-log-secret-route')
      .eq('org_id', carrier)
      .order('created_at', { ascending: false })
      .limit(1)

    expect(data?.[0]?.context).not.toHaveProperty('api_key')
    expect(data?.[0]?.context).toMatchObject({ safe_field: 'ok' })
  })
})

describe('GET /api/v1/admin/error-log', () => {
  it('a non-admin (carrier owner) gets 403', async () => {
    const res = await call(carrierOwnerToken)
    expect(res.status).toBe(403)
  })

  it('a ShipmentX admin gets the mirrored rows, filterable by route/org and paginated', async () => {
    // Seed a few rows directly (write path already covered above).
    await admin.from('app_error_log').insert([
      { route: 'api/loads GET', message: 'db error 1', org_id: carrier },
      { route: 'api/loads GET', message: 'db error 2', org_id: carrier },
      { route: 'api/invoices POST', message: 'unrelated error', org_id: carrier },
    ])

    const filtered = await call(sxOwnerToken, `?route_contains=loads&org_id=${carrier}&limit=10&offset=0`)
    expect(filtered.status).toBe(200)
    const body = await filtered.json()
    expect(body.entries.length).toBeGreaterThanOrEqual(2)
    expect(body.entries.every((e: { route: string }) => e.route.includes('loads'))).toBe(true)
    expect(body.entries.every((e: { org_id: number }) => e.org_id === carrier)).toBe(true)

    const page1 = await call(sxOwnerToken, `?org_id=${carrier}&limit=1&offset=0`)
    const page1Body = await page1.json()
    expect(page1Body.entries.length).toBe(1)
    expect(page1Body.total).toBeGreaterThanOrEqual(3)
  })
})
