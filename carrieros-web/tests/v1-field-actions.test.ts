// Chat read receipts, live location, own driver profile, vehicle service logging.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch, type TestOrg } from './helpers'
import { addMonths, nextDue } from '@/server/domain/fleet/service-log'

const admin = adminClient()
let orgA: TestOrg
let orgB: TestOrg
let ownerToken: string
let dispatcherToken: string
let d1Token: string
let d2Token: string
let otherOwnerToken: string
let d1UserId: string
let d2UserId: string
let d1Id: number
let vehicleA: number
let vehicleB: number
let ownerUserId: string

let n = 0
const key = () => `fa-key-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`
const call = async (token: string, method: string, path: string, body?: unknown, idem?: string) => {
  const res = await apiFetch(path, token, { method, headers: idem ? { 'Idempotency-Key': idem } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { res, json: await res.json() }
}
async function makeLoad(status: string, driverId: number | null) {
  const { data } = await admin.from('loads').insert({ carrier_org_id: orgA.orgId, load_number: `FA-${Date.now()}-${++n}`, status, driver_id: driverId }).select('id').single()
  return Number(data!.id)
}

describe('addMonths / nextDue (pure)', () => {
  it('clamps to the end of the month instead of overflowing (Jan 31 + 1 month = Feb 28)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29') // leap year
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30')
  })
  it('crosses year boundaries and handles large offsets', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
    expect(addMonths('2026-01-15', 24)).toBe('2028-01-15')
  })
  it('derives next-due date and miles from the reminder triggers', () => {
    expect(nextDue('2026-01-31', 100_000, { triggerMonths: 6, triggerMiles: 15_000 })).toEqual({ nextDueDate: '2026-07-31', nextDueMiles: 115_000 })
    expect(nextDue('2026-01-31', null, { triggerMonths: null, triggerMiles: 15_000 })).toEqual({ nextDueDate: null, nextDueMiles: null })
  })
})

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier')
  orgB = await createTestOrg(admin, 'carrier')
  const owner = await createTestUser(admin, orgA.orgId, 'owner')
  const dispatcher = await createTestUser(admin, orgA.orgId, 'dispatcher')
  const d1 = await createTestUser(admin, orgA.orgId, 'driver')
  const d2 = await createTestUser(admin, orgA.orgId, 'driver')
  const otherOwner = await createTestUser(admin, orgB.orgId, 'owner')
  ownerUserId = owner.userId
  d1UserId = d1.userId
  d2UserId = d2.userId
  d1Id = Number((await admin.from('drivers').insert({ carrier_org_id: orgA.orgId, profile_id: d1.userId }).select('id').single()).data!.id)
  await admin.from('drivers').insert({ carrier_org_id: orgA.orgId, profile_id: d2.userId })
  const { data: vt } = await admin.from('vehicle_types').select('id').limit(1).single()
  const mkVeh = async (org: number) => Number((await admin.from('vehicles').insert({ carrier_org_id: org, vehicle_number: `V-${Date.now()}-${++n}`, nickname: 'T', vehicle_type_id: vt!.id }).select('id').single()).data!.id)
  vehicleA = await mkVeh(orgA.orgId)
  vehicleB = await mkVeh(orgB.orgId)
  ownerToken = (await signInAs(owner)).accessToken
  dispatcherToken = (await signInAs(dispatcher)).accessToken
  d1Token = (await signInAs(d1)).accessToken
  d2Token = (await signInAs(d2)).accessToken
  otherOwnerToken = (await signInAs(otherOwner)).accessToken
})

afterAll(async () => {
  await admin.from('idempotency_keys').delete().in('org_id', [orgA.orgId, orgB.orgId])
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
})

describe('POST /loads/{id}/messages/read', () => {
  it('marks OTHER people\'s unread messages on that load read; never your own; never another load\'s', async () => {
    const load = await makeLoad('in_transit', d1Id)
    const otherLoad = await makeLoad('in_transit', d1Id)
    const mk = async (loadId: number, sender: string) => Number((await admin.from('driver_messages').insert({ load_id: loadId, carrier_org_id: orgA.orgId, sender_id: sender, body: 'hi', original_language: 'en' }).select('id').single()).data!.id)
    const fromDispatch = await mk(load, ownerUserId)
    const mine = await mk(load, d1UserId)
    const elsewhere = await mk(otherLoad, ownerUserId)

    const { res, json } = await call(d1Token, 'POST', `/api/v1/loads/${load}/messages/read`, { message_ids: [fromDispatch, mine, elsewhere] })
    expect(res.status).toBe(200)
    expect(json.updated).toBe(1)
    const read = async (id: number) => (await admin.from('driver_messages').select('read_at').eq('id', id).single()).data!.read_at
    expect(await read(fromDispatch)).toBeTruthy()
    expect(await read(mine)).toBeNull()
    expect(await read(elsewhere)).toBeNull()
    expect((await call(d1Token, 'POST', `/api/v1/loads/${load}/messages/read`, { message_ids: [fromDispatch] })).json.updated).toBe(0) // idempotent
  })

  it('another driver gets 404; finance-style roles outside chat are refused', async () => {
    const load = await makeLoad('in_transit', d1Id)
    expect((await call(d2Token, 'POST', `/api/v1/loads/${load}/messages/read`, { message_ids: [1] })).res.status).toBe(404)
    expect((await call(ownerToken, 'POST', `/api/v1/loads/${load}/messages/read`, { message_ids: [] })).res.status).toBe(400)
  })
})

describe('PUT /loads/{id}/location', () => {
  it('writes ONLY the location columns, and drops out-of-order samples', async () => {
    const load = await makeLoad('in_transit', d1Id)
    // Relative to now: a sample stamped in the future is (correctly) replaced by the server clock.
    const t1 = new Date(Date.now() - 60_000).toISOString()
    const t0 = new Date(Date.now() - 600_000).toISOString()
    expect((await call(d1Token, 'PUT', `/api/v1/loads/${load}/location`, { latitude: 39.5, longitude: -119.8, recorded_at: t1 })).res.status).toBe(200)
    // An older sample arriving late must not overwrite the newer position.
    await call(d1Token, 'PUT', `/api/v1/loads/${load}/location`, { latitude: 10, longitude: 10, recorded_at: t0 })
    const { data } = await admin.from('loads').select('status, last_location_lat, last_location_lng, last_location_at').eq('id', load).single()
    expect(data).toMatchObject({ status: 'in_transit', last_location_lat: 39.5, last_location_lng: -119.8 })
    expect(new Date(data!.last_location_at!).toISOString()).toBe(t1)
  })

  it('a client cannot smuggle other columns: status/rate in the body are ignored', async () => {
    const load = await makeLoad('in_transit', d1Id)
    await call(d1Token, 'PUT', `/api/v1/loads/${load}/location`, { latitude: 1, longitude: 2, status: 'delivered', rate: 99999 })
    const { data } = await admin.from('loads').select('status, rate').eq('id', load).single()
    expect(data).toEqual({ status: 'in_transit', rate: null })
  })

  it('rejects out-of-range coordinates (400) and inactive loads (400); other driver 404; dispatcher 403', async () => {
    const active = await makeLoad('in_transit', d1Id)
    const delivered = await makeLoad('delivered', d1Id)
    expect((await call(d1Token, 'PUT', `/api/v1/loads/${active}/location`, { latitude: 95, longitude: 0 })).res.status).toBe(400)
    expect((await call(d1Token, 'PUT', `/api/v1/loads/${delivered}/location`, { latitude: 1, longitude: 2 })).res.status).toBe(400)
    expect((await call(d2Token, 'PUT', `/api/v1/loads/${active}/location`, { latitude: 1, longitude: 2 })).res.status).toBe(404)
    expect((await call(dispatcherToken, 'PUT', `/api/v1/loads/${active}/location`, { latitude: 1, longitude: 2 })).res.status).toBe(403)
  })

  it('a phone clock far in the future cannot pin the timestamp', async () => {
    const load = await makeLoad('in_transit', d1Id)
    await call(d1Token, 'PUT', `/api/v1/loads/${load}/location`, { latitude: 1, longitude: 2, recorded_at: '2099-01-01T00:00:00.000Z' })
    const at = (await admin.from('loads').select('last_location_at').eq('id', load).single()).data!.last_location_at!
    expect(new Date(at).getFullYear()).toBeLessThan(2050)
  })
})

describe('PATCH /me/driver-profile', () => {
  it('updates the caller\'s own record; protected fields and other drivers are untouched', async () => {
    const protectedBefore = (await admin.from('drivers').select('cdl_expiry, med_cert_expiry, is_active, driver_number, carrier_org_id').eq('profile_id', d1UserId).single()).data
    const otherBefore = (await admin.from('drivers').select('*').eq('profile_id', d2UserId).single()).data
    const { res } = await call(d1Token, 'PATCH', '/api/v1/me/driver-profile', {
      cdl_number: '  D1234567 ', cdl_class: 'A', cdl_state: 'nv', endorsements: ['hazmat', 'tanker', 'hazmat'],
      emergency_contact_name: 'Pat', default_vehicle_id: vehicleA,
      cdl_expiry: '2099-01-01', is_active: false, driver_number: 'HACK', carrier_org_id: orgB.orgId,
    })
    expect(res.status).toBe(200)
    const after = (await admin.from('drivers').select('*').eq('profile_id', d1UserId).single()).data!
    expect(after).toMatchObject({ cdl_number: 'D1234567', cdl_class: 'A', cdl_state: 'NV', endorsements: ['hazmat', 'tanker'], emergency_contact_name: 'Pat', default_vehicle_id: vehicleA, invite_status: 'accepted' })
    expect({ cdl_expiry: after.cdl_expiry, med_cert_expiry: after.med_cert_expiry, is_active: after.is_active, driver_number: after.driver_number, carrier_org_id: after.carrier_org_id }).toEqual(protectedBefore)
    expect((await admin.from('drivers').select('*').eq('profile_id', d2UserId).single()).data).toEqual(otherBefore)
  })

  it('rejects an unknown endorsement, a bad class, and a vehicle from another org (400)', async () => {
    expect((await call(d1Token, 'PATCH', '/api/v1/me/driver-profile', { endorsements: ['forklift'] })).res.status).toBe(400)
    expect((await call(d1Token, 'PATCH', '/api/v1/me/driver-profile', { cdl_class: 'Z' })).res.status).toBe(400)
    expect((await call(d1Token, 'PATCH', '/api/v1/me/driver-profile', { default_vehicle_id: vehicleB })).res.status).toBe(400)
  })

  it('a dispatcher (no driver record) is refused', async () => {
    expect((await call(dispatcherToken, 'PATCH', '/api/v1/me/driver-profile', { cdl_number: 'x' })).res.status).toBe(403)
  })
})

describe('POST /vehicles/{id}/service-logs', () => {
  const svc = (extra: Record<string, unknown> = {}) => ({ service_type: 'Oil change', service_date: '2026-01-31', odometer: 100000, cost: 250.5, shop_name: 'Joe\'s', ...extra })

  it('logs the service and recomputes the reminder (month-end clamped) in ONE transaction', async () => {
    const { data: rem } = await admin.from('maintenance_reminders').insert({ vehicle_id: vehicleA, carrier_org_id: orgA.orgId, reminder_type: 'oil', trigger_months: 1, trigger_miles: 15000 }).select('id').single()
    const { res, json } = await call(ownerToken, 'POST', `/api/v1/vehicles/${vehicleA}/service-logs`, svc({ reminder_id: rem!.id }), key())
    expect(res.status).toBe(200)
    const { data: log } = await admin.from('service_logs').select('carrier_org_id, logged_by, cost').eq('id', json.id).single()
    expect(log).toEqual({ carrier_org_id: orgA.orgId, logged_by: ownerUserId, cost: 250.5 })
    const { data: r } = await admin.from('maintenance_reminders').select('last_service_date, last_odometer, next_due_date, next_due_miles').eq('id', rem!.id).single()
    expect(r).toEqual({ last_service_date: '2026-01-31', last_odometer: 100000, next_due_date: '2026-02-28', next_due_miles: 115000 })
  })

  it('a reminder that is not this vehicle\'s fails the WHOLE call: 404 and NO log row', async () => {
    const before = (await admin.from('service_logs').select('id').eq('vehicle_id', vehicleA)).data!.length
    const { res } = await call(ownerToken, 'POST', `/api/v1/vehicles/${vehicleA}/service-logs`, svc({ reminder_id: 99999999 }), key())
    expect(res.status).toBe(404)
    expect((await admin.from('service_logs').select('id').eq('vehicle_id', vehicleA)).data!.length).toBe(before)
  })

  it('replay with one key creates one row; dispatcher 403; another org 404', async () => {
    const k = key()
    const a = await call(ownerToken, 'POST', `/api/v1/vehicles/${vehicleA}/service-logs`, svc({ service_type: 'Tires' }), k)
    const b = await call(ownerToken, 'POST', `/api/v1/vehicles/${vehicleA}/service-logs`, svc({ service_type: 'Tires' }), k)
    expect(b.json).toEqual(a.json)
    expect((await admin.from('service_logs').select('id').eq('service_type', 'Tires').eq('vehicle_id', vehicleA)).data).toHaveLength(1)
    expect((await call(dispatcherToken, 'POST', `/api/v1/vehicles/${vehicleA}/service-logs`, svc(), key())).res.status).toBe(403)
    expect((await call(otherOwnerToken, 'POST', `/api/v1/vehicles/${vehicleA}/service-logs`, svc(), key())).res.status).toBe(404)
  })

  it.each([
    ['blank type', { service_type: '' }],
    ['bad date', { service_date: 'yesterday' }],
    ['negative cost', { cost: -1 }],
  ])('rejects %s with 400', async (_l, extra) => {
    expect((await call(ownerToken, 'POST', `/api/v1/vehicles/${vehicleA}/service-logs`, svc(extra), key())).res.status).toBe(400)
  })
})
