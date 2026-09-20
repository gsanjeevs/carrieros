// DVIR: inspection + defects atomically, condition derived server-side, signature/photo attachments
// through signed URLs. A DVIR is a safety record, so the properties that matter are that it can never
// be half-written and that the client cannot make it claim something its defects contradict.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch, type TestOrg, type TestUser } from './helpers'

const admin = adminClient()
let orgA: TestOrg
let orgB: TestOrg
let d1: TestUser
let d1Token: string
let d2Token: string
let ownerToken: string
let dispatcherToken: string
let otherOwnerToken: string
let d1Id: number
let vehicleId: number
let defaultVehicleId: number
const created: string[] = []

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')
let n = 0
const key = () => `dv-key-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`
const call = async (token: string, method: string, path: string, body?: unknown, idem?: string) => {
  const res = await apiFetch(path, token, { method, headers: idem ? { 'Idempotency-Key': idem } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { res, json: await res.json() }
}
async function makeLoad(vehicle: number | null = vehicleId) {
  return Number((await admin.from('loads').insert({ carrier_org_id: orgA.orgId, load_number: `DV-${Date.now()}-${++n}`, status: 'dispatched', driver_id: d1Id, vehicle_id: vehicle }).select('id').single()).data!.id)
}
const file = (token: string, loadId: number, body: Record<string, unknown>, idem = key()) => call(token, 'POST', `/api/v1/loads/${loadId}/dvir-inspections`, body, idem)
const twoDefects = [
  { area: 'brakes', description: '  air leak ', severity: 'major' },
  { area: 'tires', description: 'worn tread', severity: 'minor' },
]

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier')
  orgB = await createTestOrg(admin, 'carrier')
  d1 = await createTestUser(admin, orgA.orgId, 'driver')
  const d2 = await createTestUser(admin, orgA.orgId, 'driver')
  const owner = await createTestUser(admin, orgA.orgId, 'owner')
  const dispatcher = await createTestUser(admin, orgA.orgId, 'dispatcher')
  const otherOwner = await createTestUser(admin, orgB.orgId, 'owner')
  const { data: vt } = await admin.from('vehicle_types').select('id').limit(1).single()
  const mkVeh = async () => Number((await admin.from('vehicles').insert({ carrier_org_id: orgA.orgId, vehicle_number: `V-${Date.now()}-${++n}`, nickname: 'T', vehicle_type_id: vt!.id }).select('id').single()).data!.id)
  vehicleId = await mkVeh()
  defaultVehicleId = await mkVeh()
  d1Id = Number((await admin.from('drivers').insert({ carrier_org_id: orgA.orgId, profile_id: d1.userId, default_vehicle_id: defaultVehicleId }).select('id').single()).data!.id)
  await admin.from('drivers').insert({ carrier_org_id: orgA.orgId, profile_id: d2.userId })
  d1Token = (await signInAs(d1)).accessToken
  d2Token = (await signInAs(d2)).accessToken
  ownerToken = (await signInAs(owner)).accessToken
  dispatcherToken = (await signInAs(dispatcher)).accessToken
  otherOwnerToken = (await signInAs(otherOwner)).accessToken
})

afterAll(async () => {
  if (created.length) await admin.storage.from('documents').remove(created)
  await admin.from('idempotency_keys').delete().in('org_id', [orgA.orgId, orgB.orgId])
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
})

describe('POST /loads/{id}/dvir-inspections', () => {
  it('files the inspection and its defects together; org, driver and vehicle come from the server', async () => {
    const load = await makeLoad()
    const { res, json } = await file(d1Token, load, { type: 'pre_trip', odometer: 120000, defects: twoDefects, carrier_org_id: orgB.orgId, driver_id: 9999 })
    expect(res.status).toBe(200)
    expect(json.defects.map((d: { area: string }) => d.area).sort()).toEqual(['brakes', 'tires'])
    const { data: insp } = await admin.from('dvir_inspections').select('carrier_org_id, driver_id, vehicle_id, load_id, type, condition, odometer').eq('id', json.id).single()
    expect(insp).toEqual({ carrier_org_id: orgA.orgId, driver_id: d1Id, vehicle_id: vehicleId, load_id: load, type: 'pre_trip', condition: 'defects_noted', odometer: 120000 })
    const { data: defs } = await admin.from('dvir_defects').select('area, description, severity').eq('inspection_id', json.id).order('area')
    expect(defs).toEqual([{ area: 'brakes', description: 'air leak', severity: 'major' }, { area: 'tires', description: 'worn tread', severity: 'minor' }])
  })

  it('condition is DERIVED: no defects = satisfactory, and a client-supplied condition is ignored', async () => {
    const clean = await file(d1Token, await makeLoad(), { type: 'post_trip', defects: [] })
    expect((await admin.from('dvir_inspections').select('condition').eq('id', clean.json.id).single()).data!.condition).toBe('satisfactory')
    const lying = await file(d1Token, await makeLoad(), { type: 'pre_trip', condition: 'satisfactory', defects: twoDefects })
    expect((await admin.from('dvir_inspections').select('condition').eq('id', lying.json.id).single()).data!.condition).toBe('defects_noted')
  })

  it('a load with no vehicle falls back to the driver\'s default vehicle', async () => {
    const { json } = await file(d1Token, await makeLoad(null), { type: 'pre_trip', defects: [] })
    expect((await admin.from('dvir_inspections').select('vehicle_id').eq('id', json.id).single()).data!.vehicle_id).toBe(defaultVehicleId)
  })

  it('is ATOMIC at the database: a defect that fails a constraint rolls the inspection back too', async () => {
    const load = await makeLoad()
    const { client } = await signInAs(d1)
    const { error } = await client.rpc('submit_dvir_inspection', {
      p_load_id: load, p_vehicle_id: vehicleId, p_driver_id: d1Id, p_type: 'pre_trip', p_condition: 'defects_noted', p_odometer: 1,
      p_defects: [{ area: 'brakes', description: 'x', severity: 'catastrophic' }] as never,
    })
    expect(error).not.toBeNull()
    expect((await admin.from('dvir_inspections').select('id').eq('load_id', load)).data).toHaveLength(0)
  })

  it('replay with one key files ONE inspection', async () => {
    const load = await makeLoad()
    const k = key()
    const a = await file(d1Token, load, { type: 'pre_trip', defects: twoDefects }, k)
    const b = await file(d1Token, load, { type: 'pre_trip', defects: twoDefects }, k)
    expect(b.json).toEqual(a.json)
    expect((await admin.from('dvir_inspections').select('id').eq('load_id', load)).data).toHaveLength(1)
  })

  it('owner-operator files with no driver id; dispatcher 403; other driver / other org 404', async () => {
    const load = await makeLoad()
    const own = await file(ownerToken, load, { type: 'pre_trip', defects: [] })
    expect(own.res.status).toBe(200)
    expect((await admin.from('dvir_inspections').select('driver_id').eq('id', own.json.id).single()).data!.driver_id).toBeNull()
    expect((await file(dispatcherToken, load, { type: 'pre_trip', defects: [] })).res.status).toBe(403)
    expect((await file(d2Token, load, { type: 'pre_trip', defects: [] })).res.status).toBe(404)
    expect((await file(otherOwnerToken, load, { type: 'pre_trip', defects: [] })).res.status).toBe(404)
  })

  it.each([
    ['unknown area', { type: 'pre_trip', defects: [{ area: 'windshield', description: 'x', severity: 'minor' }] }],
    ['duplicate area', { type: 'pre_trip', defects: [twoDefects[0], twoDefects[0]] }],
    ['blank description', { type: 'pre_trip', defects: [{ area: 'horn', description: '  ', severity: 'minor' }] }],
    ['bad severity', { type: 'pre_trip', defects: [{ area: 'horn', description: 'x', severity: 'fatal' }] }],
    ['bad type', { type: 'mid_trip', defects: [] }],
  ])('rejects %s with 400 and writes nothing', async (_l, body) => {
    const load = await makeLoad()
    expect((await file(d1Token, load, body)).res.status).toBe(400)
    expect((await admin.from('dvir_inspections').select('id').eq('load_id', load)).data).toHaveLength(0)
  })
})

describe('attachments (signature + defect photos)', () => {
  async function inspection() {
    const { json } = await file(d1Token, await makeLoad(), { type: 'pre_trip', defects: twoDefects })
    return json.id as number
  }
  async function attach(token: string, id: number, body: Record<string, unknown>) {
    const slot = await call(token, 'POST', `/api/v1/dvir-inspections/${id}/attachment-uploads`, body)
    if (slot.res.status !== 200) return { slot, put: 0, fin: null as null | Awaited<ReturnType<typeof call>> }
    created.push(slot.json.storage_path)
    const put = (await fetch(slot.json.upload_url, { method: 'PUT', headers: { 'Content-Type': slot.json.content_type }, body: PNG })).status
    const fin = await call(token, 'POST', `/api/v1/dvir-inspections/${id}/attachments`, { kind: body.kind, area: body.area, storage_path: slot.json.storage_path }, key())
    return { slot, put, fin }
  }

  it('signature: signed URL -> PUT -> finalize sets signature_url to the server-chosen path', async () => {
    const id = await inspection()
    const { slot, put, fin } = await attach(d1Token, id, { kind: 'signature', content_type: 'image/png' })
    expect(slot.json.storage_path).toMatch(new RegExp(`^${orgA.orgId}/dvir/${id}/signature-[0-9a-f-]{36}\\.png$`))
    expect(put).toBe(200)
    expect(fin!.res.status).toBe(200)
    expect((await admin.from('dvir_inspections').select('signature_url').eq('id', id).single()).data!.signature_url).toBe(slot.json.storage_path)
  })

  it('defect photo: attaches to THAT area\'s defect only', async () => {
    const id = await inspection()
    const { slot, fin } = await attach(d1Token, id, { kind: 'defect_photo', area: 'brakes', content_type: 'image/png' })
    expect(fin!.res.status).toBe(200)
    const { data } = await admin.from('dvir_defects').select('area, photo_path').eq('inspection_id', id).order('area')
    expect(data).toEqual([{ area: 'brakes', photo_path: slot.json.storage_path }, { area: 'tires', photo_path: null }])
  })

  it('refuses: a path never issued, a missing upload, a photo for an area with no defect, and a defect_photo without an area', async () => {
    const id = await inspection()
    const foreign = `${orgB.orgId}/dvir/${id}/signature-${crypto.randomUUID()}.png`
    await admin.storage.from('documents').upload(foreign, PNG, { contentType: 'image/png' })
    created.push(foreign)
    expect((await call(d1Token, 'POST', `/api/v1/dvir-inspections/${id}/attachments`, { kind: 'signature', storage_path: foreign }, key())).res.status).toBe(400)

    const slot = await call(d1Token, 'POST', `/api/v1/dvir-inspections/${id}/attachment-uploads`, { kind: 'signature', content_type: 'image/png' })
    created.push(slot.json.storage_path)
    expect((await call(d1Token, 'POST', `/api/v1/dvir-inspections/${id}/attachments`, { kind: 'signature', storage_path: slot.json.storage_path }, key())).res.status).toBe(400) // never uploaded

    const horn = await attach(d1Token, id, { kind: 'defect_photo', area: 'horn', content_type: 'image/png' }) // no horn defect on this inspection
    expect(horn.fin!.res.status).toBe(404)
    expect((await call(d1Token, 'POST', `/api/v1/dvir-inspections/${id}/attachment-uploads`, { kind: 'defect_photo', content_type: 'image/png' })).res.status).toBe(400)
  })

  it('another driver, dispatcher and another org cannot touch it', async () => {
    const id = await inspection()
    for (const token of [d2Token, otherOwnerToken]) {
      expect((await call(token, 'POST', `/api/v1/dvir-inspections/${id}/attachment-uploads`, { kind: 'signature', content_type: 'image/png' })).res.status).toBe(404)
    }
    expect((await call(dispatcherToken, 'POST', `/api/v1/dvir-inspections/${id}/attachment-uploads`, { kind: 'signature', content_type: 'image/png' })).res.status).toBe(403)
  })
})
