// IFTA mileage: GPS crossings and the manual override. Properties: server-side entitlement gating
// (previously the phone alone decided), driver-own-load, idempotent GPS inserts, and the atomic
// replace that finally works FOR DRIVERS (the old client-side delete was silently blocked by RLS).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch, type TestOrg } from './helpers'

const admin = adminClient()
let grow: TestOrg // growth tier: entitled
let starter: TestOrg // starter tier: not entitled
let d1Token: string
let d2Token: string
let dispatcherToken: string
let starterDriverToken: string
let d1Id: number
let vehicleId: number
let loadId: number

let n = 0
const key = () => `ifta-key-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`
const call = async (token: string, method: string, path: string, body?: unknown, idem?: string) => {
  const res = await apiFetch(path, token, { method, headers: idem ? { 'Idempotency-Key': idem } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { res, json: await res.json() }
}
const crossings = async (id: number) => (await admin.from('ifta_state_crossings').select('state, source, odometer_est, driver_id, vehicle_id, carrier_org_id').eq('load_id', id).order('id')).data!

beforeAll(async () => {
  grow = await createTestOrg(admin, 'carrier', { tier: 'growth' })
  starter = await createTestOrg(admin, 'carrier', { tier: 'starter' })
  const d1 = await createTestUser(admin, grow.orgId, 'driver')
  const d2 = await createTestUser(admin, grow.orgId, 'driver')
  const dispatcher = await createTestUser(admin, grow.orgId, 'dispatcher')
  const sd = await createTestUser(admin, starter.orgId, 'driver')
  d1Id = Number((await admin.from('drivers').insert({ carrier_org_id: grow.orgId, profile_id: d1.userId }).select('id').single()).data!.id)
  await admin.from('drivers').insert({ carrier_org_id: grow.orgId, profile_id: d2.userId })
  const sdId = Number((await admin.from('drivers').insert({ carrier_org_id: starter.orgId, profile_id: sd.userId }).select('id').single()).data!.id)
  const { data: vt } = await admin.from('vehicle_types').select('id').limit(1).single()
  vehicleId = Number((await admin.from('vehicles').insert({ carrier_org_id: grow.orgId, vehicle_number: `V-${Date.now()}`, nickname: 'T', vehicle_type_id: vt!.id }).select('id').single()).data!.id)
  loadId = Number((await admin.from('loads').insert({ carrier_org_id: grow.orgId, load_number: `IF-${Date.now()}`, status: 'in_transit', driver_id: d1Id, vehicle_id: vehicleId }).select('id').single()).data!.id)
  starterLoad = Number((await admin.from('loads').insert({ carrier_org_id: starter.orgId, load_number: `IFS-${Date.now()}`, status: 'in_transit', driver_id: sdId }).select('id').single()).data!.id)
  d1Token = (await signInAs(d1)).accessToken
  d2Token = (await signInAs(d2)).accessToken
  dispatcherToken = (await signInAs(dispatcher)).accessToken
  starterDriverToken = (await signInAs(sd)).accessToken
})
let starterLoad: number

afterAll(async () => {
  await admin.from('idempotency_keys').delete().in('org_id', [grow.orgId, starter.orgId])
  await cleanupTestOrg(admin, grow.orgId)
  await cleanupTestOrg(admin, starter.orgId)
})

const crossing = (state = 'nv', extra: Record<string, unknown> = {}) => ({ state, crossed_at: new Date(Date.now() - 60_000).toISOString(), latitude: 39.5, longitude: -119.8, ...extra })

describe('POST /loads/{id}/ifta-crossings (GPS)', () => {
  it('a driver records a crossing on their own load; org, driver and vehicle are derived server-side', async () => {
    const { res } = await call(d1Token, 'POST', `/api/v1/loads/${loadId}/ifta-crossings`, { ...crossing('nv'), carrier_org_id: starter.orgId, driver_id: 999 }, key())
    expect(res.status).toBe(200)
    const rows = await crossings(loadId)
    expect(rows).toEqual([{ state: 'NV', source: 'gps', odometer_est: null, driver_id: d1Id, vehicle_id: vehicleId, carrier_org_id: grow.orgId }])
  })

  it('a replay (same key) creates ONE row; the phone derives its key from load+state+time so retries are safe', async () => {
    const id = Number((await admin.from('loads').insert({ carrier_org_id: grow.orgId, load_number: `IF-${Date.now()}-r`, status: 'in_transit', driver_id: d1Id }).select('id').single()).data!.id)
    const k = key()
    await call(d1Token, 'POST', `/api/v1/loads/${id}/ifta-crossings`, crossing('ut'), k)
    await call(d1Token, 'POST', `/api/v1/loads/${id}/ifta-crossings`, crossing('ut'), k)
    expect(await crossings(id)).toHaveLength(1)
  })

  it('another driver 404; dispatcher allowed; bad state 400', async () => {
    expect((await call(d2Token, 'POST', `/api/v1/loads/${loadId}/ifta-crossings`, crossing('id'), key())).res.status).toBe(404)
    expect((await call(dispatcherToken, 'POST', `/api/v1/loads/${loadId}/ifta-crossings`, crossing('or'), key())).res.status).toBe(200)
    expect((await call(d1Token, 'POST', `/api/v1/loads/${loadId}/ifta-crossings`, crossing('XYZ'), key())).res.status).toBe(400)
  })

  it('is refused (402) for an org whose plan lacks ifta_mileage_log, and writes nothing', async () => {
    const { res, json } = await call(starterDriverToken, 'POST', `/api/v1/loads/${starterLoad}/ifta-crossings`, crossing('nv'), key())
    expect(res.status).toBe(402)
    expect(json.error_code).toBe('TIER_UPGRADE_REQUIRED')
    expect(await crossings(starterLoad)).toHaveLength(0)
  })
})

describe('PUT /loads/{id}/ifta-crossings/manual', () => {
  async function loadWithGps() {
    const id = Number((await admin.from('loads').insert({ carrier_org_id: grow.orgId, load_number: `IF-${Date.now()}-${++n}`, status: 'delivered', driver_id: d1Id, vehicle_id: vehicleId }).select('id').single()).data!.id)
    await call(d1Token, 'POST', `/api/v1/loads/${id}/ifta-crossings`, crossing('ca'), key())
    await call(d1Token, 'POST', `/api/v1/loads/${id}/ifta-crossings`, crossing('nv'), key())
    return id
  }

  it('a DRIVER replaces GPS crossings with manual mileage (the old client-side delete was silently blocked by RLS)', async () => {
    const id = await loadWithGps()
    expect((await crossings(id)).map((r) => r.source)).toEqual(['gps', 'gps'])
    const { res, json } = await call(d1Token, 'PUT', `/api/v1/loads/${id}/ifta-crossings/manual`, { rows: [{ state: 'nv', miles: 120 }, { state: 'CA', miles: 80 }] })
    expect(res.status).toBe(200)
    expect(json.written).toBe(2)
    const rows = await crossings(id)
    expect(rows.map((r) => `${r.source}:${r.state}:${r.odometer_est}`)).toEqual(['manual:NV:120', 'manual:CA:80'])
    expect(rows.every((r) => r.carrier_org_id === grow.orgId && r.driver_id === d1Id)).toBe(true)
  })

  it('is atomic: an entirely invalid set is rejected and the GPS rows SURVIVE', async () => {
    const id = await loadWithGps()
    const { res } = await call(d1Token, 'PUT', `/api/v1/loads/${id}/ifta-crossings/manual`, { rows: [{ state: 'NEVADA', miles: 5 }] })
    expect(res.status).toBe(400)
    expect((await crossings(id)).map((r) => r.source)).toEqual(['gps', 'gps'])
  })

  it('another driver 404 and the load is untouched; starter plan 402', async () => {
    const id = await loadWithGps()
    expect((await call(d2Token, 'PUT', `/api/v1/loads/${id}/ifta-crossings/manual`, { rows: [{ state: 'NV', miles: 5 }] })).res.status).toBe(404)
    expect((await crossings(id)).map((r) => r.source)).toEqual(['gps', 'gps'])
    expect((await call(starterDriverToken, 'PUT', `/api/v1/loads/${starterLoad}/ifta-crossings/manual`, { rows: [{ state: 'NV', miles: 5 }] })).res.status).toBe(402)
  })
})
