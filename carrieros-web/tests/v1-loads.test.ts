// /api/v1/loads: one service behind both clients. Covers the rules that used to
// be enforced differently per app: tenant scoping, drivers only see their own
// loads, and `rate` is ABSENT from the payload for roles that may not see money.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch,
  type TestOrg, type TestUser,
} from './helpers'

const admin = adminClient()
let orgA: TestOrg
let orgB: TestOrg
let owner: TestUser
let dispatcher: TestUser
let driverUser: TestUser
let ownerToken: string
let dispatcherToken: string
let driverToken: string
let otherOrgOwnerToken: string
const ids: Record<string, number> = {}

async function insertLoad(orgId: number, status: string, driverId: number | null, tag: string) {
  const { data, error } = await admin
    .from('loads')
    .insert({
      carrier_org_id: orgId,
      load_number: `V1-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e5)}`,
      status,
      rate: 1234.5,
      driver_id: driverId,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`insertLoad: ${error?.message}`)
  return Number(data.id)
}

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier')
  orgB = await createTestOrg(admin, 'carrier')
  owner = await createTestUser(admin, orgA.orgId, 'owner')
  dispatcher = await createTestUser(admin, orgA.orgId, 'dispatcher')
  driverUser = await createTestUser(admin, orgA.orgId, 'driver')
  const otherOwner = await createTestUser(admin, orgB.orgId, 'owner')

  const { data: driverRow, error } = await admin
    .from('drivers')
    .insert({ carrier_org_id: orgA.orgId, profile_id: driverUser.userId })
    .select('id')
    .single()
  if (error || !driverRow) throw new Error(`driver insert: ${error?.message}`)
  const driverId = Number(driverRow.id)

  ids.draftUnassigned = await insertLoad(orgA.orgId, 'draft', null, 'draft')
  ids.transitMine = await insertLoad(orgA.orgId, 'in_transit', driverId, 'mine')
  ids.otherOrg = await insertLoad(orgB.orgId, 'in_transit', null, 'other')

  ownerToken = (await signInAs(owner)).accessToken
  dispatcherToken = (await signInAs(dispatcher)).accessToken
  driverToken = (await signInAs(driverUser)).accessToken
  otherOrgOwnerToken = (await signInAs(otherOwner)).accessToken
})

afterAll(async () => {
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
})

const list = async (token: string, qs = '') => {
  const res = await apiFetch(`/api/v1/loads${qs}`, token)
  return { res, body: await res.json() }
}

describe('GET /api/v1/loads', () => {
  it('rejects unauthenticated callers with the typed error contract', async () => {
    const res = await fetch(`${process.env.TEST_APP_URL ?? 'http://localhost:3000'}/api/v1/loads`)
    expect(res.status).toBe(401)
    expect((await res.json()).error_code).toBe('AUTH_REQUIRED')
  })

  it('owner sees their own org\'s loads, with rate, and never another org\'s', async () => {
    const { res, body } = await list(ownerToken)
    expect(res.status).toBe(200)
    const got = body.loads.map((l: { id: number }) => l.id)
    expect(got).toContain(ids.draftUnassigned)
    expect(got).toContain(ids.transitMine)
    expect(got).not.toContain(ids.otherOrg)
    expect(body.can_see_rate).toBe(true)
    expect(body.loads[0].rate).toBe(1234.5)
  })

  it('a role without money access gets NO rate key at all', async () => {
    const { body } = await list(dispatcherToken)
    expect(body.can_see_rate).toBe(false)
    expect(body.loads.length).toBeGreaterThan(0)
    for (const load of body.loads) expect('rate' in load).toBe(false)
  })

  it('a driver sees only their own loads and no rate', async () => {
    const { body } = await list(driverToken)
    expect(body.loads.map((l: { id: number }) => l.id)).toEqual([ids.transitMine])
    expect('rate' in body.loads[0]).toBe(false)
    expect(body.can_see_rate).toBe(false)
  })

  it('filters by status group', async () => {
    const { body } = await list(ownerToken, '?status_group=needs_dispatch')
    const got = body.loads.map((l: { id: number }) => l.id)
    expect(got).toContain(ids.draftUnassigned)
    expect(got).not.toContain(ids.transitMine)
  })

  it('rejects an unknown status group with 400', async () => {
    const { res, body } = await list(ownerToken, '?status_group=nonsense')
    expect(res.status).toBe(400)
    expect(body.error_code).toBe('VALIDATION_ERROR')
  })

  it('another tenant\'s owner cannot see this org\'s loads', async () => {
    const { body } = await list(otherOrgOwnerToken)
    const got = body.loads.map((l: { id: number }) => l.id)
    expect(got).toContain(ids.otherOrg)
    expect(got).not.toContain(ids.draftUnassigned)
  })
})
