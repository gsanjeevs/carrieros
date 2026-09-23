// POST /api/v1/loads/{id}/fuel-stops and /problem-reports, plus the shared
// idempotency lifecycle they use. Proves: who may act on which load, server-side
// derivation of org/actor/driver/vehicle/total (never from the request), validation,
// and exactly-once under replay AND under concurrency.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch, type TestOrg } from './helpers'

const admin = adminClient()
let orgA: TestOrg
let orgB: TestOrg
let ownerToken: string
let dispatcherToken: string
let financeToken: string
let driver1Token: string
let driver2Token: string
let otherOwnerToken: string
let driver1Id: number
let vehicleId: number
let ownerUserId: string
let driver1UserId: string

let n = 0
const key = () => `da-key-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`

async function makeLoad(orgId: number, driverId: number | null = null, veh: number | null = null) {
  const { data, error } = await admin
    .from('loads')
    .insert({ carrier_org_id: orgId, load_number: `DA-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, status: 'in_transit', driver_id: driverId, vehicle_id: veh })
    .select('id')
    .single()
  if (error || !data) throw new Error(`makeLoad: ${error?.message}`)
  return Number(data.id)
}

async function post(token: string, path: string, body: unknown, idem: string | null = key()) {
  const res = await apiFetch(path, token, { method: 'POST', headers: idem ? { 'Idempotency-Key': idem } : {}, body: JSON.stringify(body) })
  return { res, json: await res.json() }
}
const fuel = (id: number) => `/api/v1/loads/${id}/fuel-stops`
const problem = (id: number) => `/api/v1/loads/${id}/problem-reports`
const validFuel = { state: 'nv', gallons: 100, price_per_gallon: 4.25 }

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier')
  orgB = await createTestOrg(admin, 'carrier')
  const owner = await createTestUser(admin, orgA.orgId, 'owner')
  const dispatcher = await createTestUser(admin, orgA.orgId, 'dispatcher')
  const finance = await createTestUser(admin, orgA.orgId, 'finance')
  const d1 = await createTestUser(admin, orgA.orgId, 'driver')
  const d2 = await createTestUser(admin, orgA.orgId, 'driver')
  const otherOwner = await createTestUser(admin, orgB.orgId, 'owner')
  ownerUserId = owner.userId
  driver1UserId = d1.userId

  const mkDriver = async (profileId: string) => {
    const { data, error } = await admin.from('drivers').insert({ carrier_org_id: orgA.orgId, profile_id: profileId }).select('id').single()
    if (error || !data) throw new Error(`driver: ${error?.message}`)
    return Number(data.id)
  }
  driver1Id = await mkDriver(d1.userId)
  await mkDriver(d2.userId)
  const { data: vt } = await admin.from('vehicle_types').select('id').limit(1).single()
  const { data: veh, error: vErr } = await admin.from('vehicles').insert({ carrier_org_id: orgA.orgId, vehicle_number: `V-${Date.now()}`, nickname: 'Test Truck', vehicle_type_id: vt!.id }).select('id').single()
  if (vErr || !veh) throw new Error(`vehicle: ${vErr?.message}`)
  vehicleId = Number(veh.id)

  ownerToken = (await signInAs(owner)).accessToken
  dispatcherToken = (await signInAs(dispatcher)).accessToken
  financeToken = (await signInAs(finance)).accessToken
  driver1Token = (await signInAs(d1)).accessToken
  driver2Token = (await signInAs(d2)).accessToken
  otherOwnerToken = (await signInAs(otherOwner)).accessToken
})

afterAll(async () => {
  await admin.from('idempotency_keys').delete().in('org_id', [orgA.orgId, orgB.orgId])
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
})

describe('POST /api/v1/loads/{id}/fuel-stops', () => {
  it('a driver logs fuel on their own load; org, driver, vehicle, logger and total are derived server-side', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    const { res, json } = await post(driver1Token, fuel(id), { ...validFuel, station: '  Pilot  ' })
    expect(res.status).toBe(200)
    expect(json.total_cost).toBe(425)
    const { data } = await admin.from('fuel_stops').select('*').eq('id', json.id).single()
    expect(data).toMatchObject({
      carrier_org_id: orgA.orgId, load_id: id, vehicle_id: vehicleId, driver_id: driver1Id,
      state: 'NV', station: 'Pilot', gallons: 100, price_per_gallon: 4.25, total_cost: 425, logged_by: driver1UserId,
    })
  })

  it('an owner logging on a driver\'s load attributes it to the load\'s driver, logged_by the owner', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    const { res, json } = await post(ownerToken, fuel(id), { state: 'CA', gallons: 50, total_cost: 200 })
    expect(res.status).toBe(200)
    expect(json.total_cost).toBe(200)
    const { data } = await admin.from('fuel_stops').select('driver_id, logged_by').eq('id', json.id).single()
    expect(data).toEqual({ driver_id: driver1Id, logged_by: ownerUserId })
  })

  it('a client cannot smuggle in another org or a different logger: extra fields are ignored', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    const { json } = await post(driver1Token, fuel(id), { ...validFuel, carrier_org_id: orgB.orgId, logged_by: ownerUserId, driver_id: 999999 })
    const { data } = await admin.from('fuel_stops').select('carrier_org_id, logged_by, driver_id').eq('id', json.id).single()
    expect(data).toEqual({ carrier_org_id: orgA.orgId, logged_by: driver1UserId, driver_id: driver1Id })
  })

  it('denies: another driver (404), another org (404), finance (403)', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    expect((await post(driver2Token, fuel(id), validFuel)).res.status).toBe(404)
    expect((await post(otherOwnerToken, fuel(id), validFuel)).res.status).toBe(404)
    const fin = await post(financeToken, fuel(id), validFuel)
    expect(fin.res.status).toBe(403)
    expect(fin.json.error_code).toBe('FORBIDDEN')
    const { data } = await admin.from('fuel_stops').select('id').eq('load_id', id)
    expect(data).toHaveLength(0)
  })

  it('a dispatcher may log fuel', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    expect((await post(dispatcherToken, fuel(id), validFuel)).res.status).toBe(200)
  })

  it.each([
    ['bad state', { state: 'NEVADA', gallons: 10 }],
    ['zero gallons', { state: 'NV', gallons: 0 }],
    ['absurd gallons', { state: 'NV', gallons: 5000 }],
    ['negative price', { state: 'NV', gallons: 10, price_per_gallon: -1 }],
  ])('rejects %s with 400', async (_l, body) => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    const { res, json } = await post(driver1Token, fuel(id), body)
    expect(res.status).toBe(400)
    expect(json.error_code).toBe('VALIDATION_ERROR')
  })

  it('requires an Idempotency-Key', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    expect((await post(driver1Token, fuel(id), validFuel, null)).res.status).toBe(400)
  })
})

describe('idempotency (shared lifecycle)', () => {
  it('replaying the same key with the same body returns the original result and creates ONE row', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    const k = key()
    const first = await post(driver1Token, fuel(id), validFuel, k)
    const replay = await post(driver1Token, fuel(id), validFuel, k)
    expect(replay.res.status).toBe(200)
    expect(replay.json).toEqual(first.json)
    const { data } = await admin.from('fuel_stops').select('id').eq('load_id', id)
    expect(data).toHaveLength(1)
  })

  it('the same key with a different body is 422 IDEMPOTENCY_KEY_REUSED and creates nothing more', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    const k = key()
    await post(driver1Token, fuel(id), validFuel, k)
    const { res, json } = await post(driver1Token, fuel(id), { ...validFuel, gallons: 999 }, k)
    expect(res.status).toBe(422)
    expect(json.error_code).toBe('IDEMPOTENCY_KEY_REUSED')
    const { data } = await admin.from('fuel_stops').select('id').eq('load_id', id)
    expect(data).toHaveLength(1)
  })

  it('field order does not matter to the body hash', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    const k = key()
    await post(driver1Token, fuel(id), { state: 'NV', gallons: 10, price_per_gallon: 4 }, k)
    const { res } = await post(driver1Token, fuel(id), { price_per_gallon: 4, gallons: 10, state: 'NV' }, k)
    expect(res.status).toBe(200)
  })

  it('CONCURRENT requests with one key create exactly one row (the reservation arbitrates)', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    const k = key()
    const results = await Promise.all(Array.from({ length: 6 }, () => post(driver1Token, fuel(id), validFuel, k)))
    const statuses = results.map((r) => r.res.status).sort()
    // Every response is either the created result, a replay of it, or "still in progress" (409): never a second create.
    for (const s of statuses) expect([200, 409]).toContain(s)
    expect(statuses).toContain(200)
    const { data } = await admin.from('fuel_stops').select('id').eq('load_id', id)
    expect(data).toHaveLength(1)
  })

  it('a request that fails validation never reserves its key', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    const k = key()
    expect((await post(driver1Token, fuel(id), { state: 'NV', gallons: 0 }, k)).res.status).toBe(400)
    const { data: held } = await admin.from('idempotency_keys').select('id').eq('idempotency_key', k)
    expect(held).toHaveLength(0)
  })

  it('an authorization failure also releases the key (no orphaned reservation)', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    const k = key()
    expect((await post(driver2Token, fuel(id), validFuel, k)).res.status).toBe(404)
    const { data: held } = await admin.from('idempotency_keys').select('id').eq('idempotency_key', k)
    expect(held).toHaveLength(0)
  })
})

describe('POST /api/v1/loads/{id}/problem-reports', () => {
  it('a driver reports a problem on their own load; it lands in the Exceptions inbox', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    const { res } = await post(driver1Token, problem(id), { reason: 'breakdown', note: '  flat tire near Reno ' })
    expect(res.status).toBe(200)
    const { data } = await admin.from('exception_events').select('carrier_org_id, entity_type, event_type, severity, title, detail').eq('entity_id', id)
    expect(data).toEqual([
      { carrier_org_id: orgA.orgId, entity_type: 'load', event_type: 'driver_reported_problem', severity: 'urgent', title: 'reason:breakdown', detail: 'flat tire near Reno' },
    ])
  })

  it('replay creates ONE event', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    const k = key()
    await post(driver1Token, problem(id), { reason: 'traffic' }, k)
    await post(driver1Token, problem(id), { reason: 'traffic' }, k)
    const { data } = await admin.from('exception_events').select('id').eq('entity_id', id)
    expect(data).toHaveLength(1)
  })

  it('denies: another driver (404), another org (404), dispatcher and finance (403)', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    expect((await post(driver2Token, problem(id), { reason: 'other' })).res.status).toBe(404)
    expect((await post(otherOwnerToken, problem(id), { reason: 'other' })).res.status).toBe(404)
    expect((await post(dispatcherToken, problem(id), { reason: 'other' })).res.status).toBe(403)
    expect((await post(financeToken, problem(id), { reason: 'other' })).res.status).toBe(403)
    const { data } = await admin.from('exception_events').select('id').eq('entity_id', id)
    expect(data).toHaveLength(0)
  })

  it('rejects an unknown reason with 400', async () => {
    const id = await makeLoad(orgA.orgId, driver1Id, vehicleId)
    expect((await post(driver1Token, problem(id), { reason: 'aliens' })).res.status).toBe(400)
  })
})
