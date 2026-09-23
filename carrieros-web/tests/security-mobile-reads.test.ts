// tests/security-mobile-reads.test.ts — adversarial org/role scoping checks for the read
// endpoints added to migrate mobile screens onto /api/v1 (ADR 0003 batch): GET
// /api/v1/loads/{id}, /api/v1/vehicles, /api/v1/vehicles/{id}, /api/v1/invoices,
// /api/v1/invoices/{id}, /api/v1/loads/{id}/dvir-inspections, /api/v1/dvir-inspections.
// Each of these moved a raw table read that used to be implicitly scoped by RLS behind an
// application-layer service; this file is the check that the move preserved the same
// tenant/role boundaries rather than widening them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setup, type Fixture } from './audit/roles-fixture'

const APP = process.env.TEST_APP_URL ?? 'http://localhost:3000'
let f: Fixture
beforeAll(async () => { f = await setup() }, 120_000)
afterAll(async () => { await f?.teardown() })

const api = (token: string | null, method: string, path: string) =>
  fetch(`${APP}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} })

describe('GET /api/v1/loads/{id}', () => {
  it('requires authentication', async () => {
    expect((await api(null, 'GET', `/api/v1/loads/${f.ids.loadA1}`)).status).toBe(401)
  })

  it('another org\'s owner cannot see this org\'s load', async () => {
    const res = await api(f.b.owner.token, 'GET', `/api/v1/loads/${f.ids.loadA1}`)
    expect(res.status).toBe(404)
  })

  it('a driver cannot see a coworker\'s load', async () => {
    const res = await api(f.a.driver2.token, 'GET', `/api/v1/loads/${f.ids.loadA1}`)
    expect(res.status).toBe(404)
  })

  it('a driver sees their own load, with a timeline, and never a rate key', async () => {
    const res = await api(f.a.driver1.token, 'GET', `/api/v1/loads/${f.ids.loadA1}`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.load.id).toBe(f.ids.loadA1)
    expect(Array.isArray(json.events)).toBe(true)
    expect('rate' in json.load).toBe(false)
  })

  it('an owner (invoice_actions capability) sees the rate', async () => {
    const res = await api(f.a.owner.token, 'GET', `/api/v1/loads/${f.ids.loadA1}`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.load.rate).toBe(4321)
  })
})

describe('GET /api/v1/vehicles and /api/v1/vehicles/{id}', () => {
  it('requires authentication', async () => {
    expect((await api(null, 'GET', '/api/v1/vehicles')).status).toBe(401)
    expect((await api(null, 'GET', `/api/v1/vehicles/${f.ids.vehicleB}`)).status).toBe(401)
  })

  it('org A never sees org B\'s vehicle in the list or by id', async () => {
    const list = await api(f.a.owner.token, 'GET', '/api/v1/vehicles')
    expect(list.status).toBe(200)
    const listJson = await list.json()
    expect(listJson.vehicles.some((v: { id: number }) => v.id === f.ids.vehicleB)).toBe(false)

    const detail = await api(f.a.owner.token, 'GET', `/api/v1/vehicles/${f.ids.vehicleB}`)
    expect(detail.status).toBe(404)
  })

  it('a driver (no maintenance_view capability) can still read the fleet list — matches carrier_vehicles_select RLS, which has no role restriction', async () => {
    const res = await api(f.b.driver.token, 'GET', '/api/v1/vehicles')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.vehicles.some((v: { id: number }) => v.id === f.ids.vehicleB)).toBe(true)
  })
})

describe('GET /api/v1/invoices and /api/v1/invoices/{id}', () => {
  it('requires authentication', async () => {
    expect((await api(null, 'GET', '/api/v1/invoices')).status).toBe(401)
  })

  it('dispatcher and driver are refused (403) — matches billing_invoices_all RLS (owner/solo/finance only)', async () => {
    expect((await api(f.a.dispatcher.token, 'GET', '/api/v1/invoices')).status).toBe(403)
    expect((await api(f.a.driver1.token, 'GET', '/api/v1/invoices')).status).toBe(403)
    expect((await api(f.a.dispatcher.token, 'GET', `/api/v1/invoices/${f.ids.invoiceA}`)).status).toBe(403)
  })

  it('org A\'s list never contains org B\'s invoice, and org A cannot fetch it by id', async () => {
    const list = await api(f.a.owner.token, 'GET', '/api/v1/invoices')
    expect(list.status).toBe(200)
    const listJson = await list.json()
    expect(listJson.invoices.some((i: { id: number }) => i.id === f.ids.invoiceB)).toBe(false)

    const detail = await api(f.a.owner.token, 'GET', `/api/v1/invoices/${f.ids.invoiceB}`)
    expect(detail.status).toBe(404)
  })

  it('owner sees their own org\'s invoice by id', async () => {
    const res = await api(f.a.owner.token, 'GET', `/api/v1/invoices/${f.ids.invoiceA}`)
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe(f.ids.invoiceA)
  })
})

describe('GET /api/v1/loads/{id}/dvir-inspections and /api/v1/dvir-inspections', () => {
  let inspectionA1: number
  beforeAll(async () => {
    const row = (
      await f.admin
        .from('dvir_inspections')
        .insert({ carrier_org_id: f.orgA, load_id: f.ids.loadA1, driver_id: f.ids.driverA1, type: 'pre_trip', condition: 'satisfactory' })
        .select('id')
        .single()
    ).data as { id: number }
    inspectionA1 = Number(row.id)
  })
  afterAll(async () => {
    if (inspectionA1) await f.admin.from('dvir_inspections').delete().eq('id', inspectionA1)
  })

  it('a coworker driver cannot list a load that is not theirs', async () => {
    const res = await api(f.a.driver2.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/dvir-inspections`)
    expect(res.status).toBe(404)
  })

  it('the owning driver can list their own load\'s inspections', async () => {
    const res = await api(f.a.driver1.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/dvir-inspections`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.inspections.some((i: { id: number }) => i.id === inspectionA1)).toBe(true)
  })

  it('driver history is narrowed to the driver\'s own inspections', async () => {
    const mine = await api(f.a.driver1.token, 'GET', '/api/v1/dvir-inspections')
    expect(mine.status).toBe(200)
    expect((await mine.json()).inspections.some((i: { id: number }) => i.id === inspectionA1)).toBe(true)

    const coworker = await api(f.a.driver2.token, 'GET', '/api/v1/dvir-inspections')
    expect(coworker.status).toBe(200)
    expect((await coworker.json()).inspections.some((i: { id: number }) => i.id === inspectionA1)).toBe(false)
  })

  it('another org never sees this org\'s DVIR history', async () => {
    const res = await api(f.b.owner.token, 'GET', '/api/v1/dvir-inspections')
    expect(res.status).toBe(200)
    expect((await res.json()).inspections.some((i: { id: number }) => i.id === inspectionA1)).toBe(false)
  })
})
