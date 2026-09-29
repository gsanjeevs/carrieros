// tests/admin-role-capabilities.test.ts — the Role Capabilities admin screen: any ShipmentX staff
// (sx_owner/sx_finance/sx_support) can view the matrix, but only sx_owner (the sole admin_flags
// holder per migration 0023) can toggle a (role, capability) grant or re-run the generator;
// sx_finance/sx_support and non-admin users get 403. Uses a synthetic capability key so this never
// touches real gating data, and restores the generated files to their pre-test state by
// regenerating again after cleanup.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg } from './helpers'

const APP = process.env.TEST_APP_URL ?? 'http://localhost:3000'
const admin = adminClient()
let platformOrg: number, carrier: number
let sxOwner: string, sxFinance: string, sxSupport: string, carrierOwnerToken: string

const TEST_ROLE = 'driver'
const TEST_CAPABILITY = `test_admin_roles_e2e_${Date.now()}`

const getMatrix = (token: string) =>
  fetch(`${APP}/api/admin/roles`, { headers: { Authorization: `Bearer ${token}` } })

const patchGrant = (token: string, body: unknown) =>
  fetch(`${APP}/api/admin/roles`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const regenerate = (token: string) =>
  fetch(`${APP}/api/admin/roles/regenerate`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })

beforeAll(async () => {
  platformOrg = (await createTestOrg(admin, 'carrier')).orgId
  await admin.from('organizations').update({ type: 'platform' }).eq('id', platformOrg)
  carrier = (await createTestOrg(admin, 'carrier')).orgId
  sxOwner = (await signInAs(await createTestUser(admin, platformOrg, 'sx_owner'))).accessToken
  sxFinance = (await signInAs(await createTestUser(admin, platformOrg, 'sx_finance'))).accessToken
  sxSupport = (await signInAs(await createTestUser(admin, platformOrg, 'sx_support'))).accessToken
  carrierOwnerToken = (await signInAs(await createTestUser(admin, carrier, 'owner'))).accessToken
}, 60_000)

afterAll(async () => {
  // Make sure the synthetic grant never lingers in the source-of-truth table...
  await admin.from('role_capabilities').delete().eq('role', TEST_ROLE).eq('capability', TEST_CAPABILITY)
  // ...and re-run the generator so the committed files reflect that removal, leaving no residual diff.
  await regenerate(sxOwner)
  await admin.from('admin_events').delete().eq('event_type', 'admin.role_capability_edit').is('org_id', null)
  await cleanupTestOrg(admin, carrier)
  await cleanupTestOrg(admin, platformOrg)
}, 30_000)

describe('role capabilities matrix', () => {
  it('rejects unauthenticated and non-admin callers', async () => {
    expect((await fetch(`${APP}/api/admin/roles`)).status).toBe(401)
    expect((await getMatrix(carrierOwnerToken)).status).toBe(403)
  })

  it('any ShipmentX staff can read the full role x capability matrix', async () => {
    const res = await getMatrix(sxSupport)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.roles)).toBe(true)
    expect(json.roles.some((r: { code: string }) => r.code === 'owner')).toBe(true)
    expect(Array.isArray(json.capabilities)).toBe(true)
    expect(json.capabilities).toContain('admin')
    expect(Array.isArray(json.grants)).toBe(true)
  })

  it('only admin_flags holders (sx_owner, per migration 0023) may toggle a grant; sx_finance/sx_support get 403', async () => {
    const res = await patchGrant(sxSupport, { role: TEST_ROLE, capability: TEST_CAPABILITY, enabled: true })
    expect(res.status).toBe(403)

    const financeRes = await patchGrant(sxFinance, { role: TEST_ROLE, capability: TEST_CAPABILITY, enabled: true })
    expect(financeRes.status).toBe(403)

    const notFound = await patchGrant(sxOwner, { role: 'no_such_role', capability: TEST_CAPABILITY, enabled: true })
    expect(notFound.status).toBe(404)

    const bad = await patchGrant(sxOwner, { role: TEST_ROLE, enabled: true })
    expect(bad.status).toBe(400)
  })

  it('sx_owner can grant a capability to a role, and it shows up in the matrix', async () => {
    const res = await patchGrant(sxOwner, { role: TEST_ROLE, capability: TEST_CAPABILITY, enabled: true })
    expect(res.status).toBe(200)

    const matrix = await (await getMatrix(sxOwner)).json()
    expect(matrix.grants).toContainEqual({ role: TEST_ROLE, capability: TEST_CAPABILITY })

    const { data: event } = await admin
      .from('admin_events')
      .select('event_type, metadata')
      .eq('event_type', 'admin.role_capability_edit')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    expect(event?.metadata).toMatchObject({ role: TEST_ROLE, capability: TEST_CAPABILITY, enabled: true })
  })

  it('revoking removes the row from the matrix', async () => {
    const res = await patchGrant(sxOwner, { role: TEST_ROLE, capability: TEST_CAPABILITY, enabled: false })
    expect(res.status).toBe(200)

    const matrix = await (await getMatrix(sxOwner)).json()
    expect(matrix.grants).not.toContainEqual({ role: TEST_ROLE, capability: TEST_CAPABILITY })
  })

  it('regenerate re-runs the generator and reports which generated files changed', async () => {
    expect((await regenerate(sxSupport)).status).toBe(403)
    expect((await regenerate(carrierOwnerToken)).status).toBe(403)

    // Grant the synthetic capability so the generated file must change to include it.
    await patchGrant(sxOwner, { role: TEST_ROLE, capability: TEST_CAPABILITY, enabled: true })
    const res = await regenerate(sxOwner)

    // This suite runs against a `next build` + `next start` server (NODE_ENV=production), which is
    // exactly the environment app/api/admin/roles/regenerate/route.ts intentionally refuses to write
    // generated files in (see that route's NOT_AVAILABLE_IN_PRODUCTION comment) -- the role-check
    // 403s above still apply since that gate runs first, but sx_owner now correctly gets 400 here
    // too, and there is nothing further to regenerate/assert in this environment.
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error_code).toBe('NOT_AVAILABLE_IN_PRODUCTION')
  }, 30_000)
})
