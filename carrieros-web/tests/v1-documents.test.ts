// The 3-step upload (request URL -> PUT bytes straight to storage -> finalize) and the
// signed-download list. The properties that matter: the PATH is server-chosen, a client
// cannot attach an object it wasn't issued (another org's, another load's), nothing is
// recorded until the bytes really exist, and per-load authorization holds.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch, type TestOrg } from './helpers'

const admin = adminClient()
let orgA: TestOrg
let orgB: TestOrg
let ownerToken: string
let financeToken: string
let driver1Token: string
let driver2Token: string
let otherOwnerToken: string
let driver1Id: number
let driver1UserId: string
let loadA: number // driver 1's load
const created: string[] = []

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')

let n = 0
const key = () => `doc-key-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`

async function makeLoad(orgId: number, driverId: number | null) {
  const { data, error } = await admin.from('loads').insert({ carrier_org_id: orgId, load_number: `DOC-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, status: 'delivered', driver_id: driverId }).select('id').single()
  if (error || !data) throw new Error(`makeLoad: ${error?.message}`)
  return Number(data.id)
}
const post = async (token: string, path: string, body: unknown, idem?: string) => {
  const res = await apiFetch(path, token, { method: 'POST', headers: idem ? { 'Idempotency-Key': idem } : {}, body: JSON.stringify(body) })
  return { res, json: await res.json() }
}
const intent = (token: string, loadId: number, body: Record<string, unknown> = { type: 'pod', content_type: 'image/jpeg', size_bytes: JPEG.length }) =>
  post(token, `/api/v1/loads/${loadId}/document-uploads`, body)
const finalize = (token: string, loadId: number, body: Record<string, unknown>, idem = key()) => post(token, `/api/v1/loads/${loadId}/documents`, body, idem)
const list = async (token: string, loadId: number) => {
  const res = await apiFetch(`/api/v1/loads/${loadId}/documents?type=pod`, token)
  return { res, json: await res.json() }
}
async function putBytes(url: string, contentType = 'image/jpeg') {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: JPEG })
  return res.status
}
/** Full happy path; returns the finalize response and the issued path. */
async function uploadPod(token: string, loadId: number) {
  const i = await intent(token, loadId)
  expect(i.res.status).toBe(200)
  created.push(i.json.storage_path)
  expect(await putBytes(i.json.upload_url)).toBe(200)
  const f = await finalize(token, loadId, { type: 'pod', storage_path: i.json.storage_path })
  return { i, f }
}

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier')
  orgB = await createTestOrg(admin, 'carrier')
  const owner = await createTestUser(admin, orgA.orgId, 'owner')
  const finance = await createTestUser(admin, orgA.orgId, 'finance')
  const d1 = await createTestUser(admin, orgA.orgId, 'driver')
  const d2 = await createTestUser(admin, orgA.orgId, 'driver')
  const otherOwner = await createTestUser(admin, orgB.orgId, 'owner')
  driver1UserId = d1.userId
  const mk = async (id: string) => Number((await admin.from('drivers').insert({ carrier_org_id: orgA.orgId, profile_id: id }).select('id').single()).data!.id)
  driver1Id = await mk(d1.userId)
  await mk(d2.userId)
  loadA = await makeLoad(orgA.orgId, driver1Id)
  ownerToken = (await signInAs(owner)).accessToken
  financeToken = (await signInAs(finance)).accessToken
  driver1Token = (await signInAs(d1)).accessToken
  driver2Token = (await signInAs(d2)).accessToken
  otherOwnerToken = (await signInAs(otherOwner)).accessToken
})

afterAll(async () => {
  if (created.length) await admin.storage.from('documents').remove(created)
  await admin.from('idempotency_keys').delete().in('org_id', [orgA.orgId, orgB.orgId])
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
})

describe('happy path', () => {
  it('request URL -> PUT bytes to storage -> finalize -> list returns a working signed download URL', async () => {
    const { i, f } = await uploadPod(driver1Token, loadA)
    expect(i.json.storage_path).toMatch(new RegExp(`^${orgA.orgId}/loads/${loadA}/pod-[0-9a-f-]{36}\\.jpg$`))
    expect(f.res.status).toBe(200)
    expect(f.json).toMatchObject({ type: 'pod', storage_path: i.json.storage_path })

    const { data: row } = await admin.from('documents').select('load_id, carrier_org_id, type, uploaded_by').eq('id', f.json.id).single()
    expect(row).toEqual({ load_id: loadA, carrier_org_id: orgA.orgId, type: 'pod', uploaded_by: driver1UserId })

    const listed = await list(driver1Token, loadA)
    const doc = listed.json.documents.find((d: { id: number }) => d.id === f.json.id)
    expect(doc.url).toBeTruthy()
    const bytes = Buffer.from(await (await fetch(doc.url)).arrayBuffer())
    expect(bytes.equals(JPEG)).toBe(true)
  })

  it('an owner may attach a document to any load in the org; finance may list but not upload', async () => {
    expect((await intent(ownerToken, loadA)).res.status).toBe(200)
    const denied = await intent(financeToken, loadA)
    expect(denied.res.status).toBe(403)
    expect((await list(financeToken, loadA)).res.status).toBe(200)
  })
})

describe('the path is not the client\'s to choose', () => {
  it('finalize refuses a path that was never issued for this load (400 NOT_ISSUED)', async () => {
    const { res, json } = await finalize(driver1Token, loadA, { type: 'pod', storage_path: `${orgA.orgId}/loads/${loadA}/pod-${crypto.randomUUID()}.jpg`.replace('pod-', 'pod-') + '/../x' })
    expect(res.status).toBe(400)
    expect(json.error_code).toBe('VALIDATION_ERROR')
  })

  it('a client cannot attach ANOTHER ORG\'s object to its own load', async () => {
    const foreign = `${orgB.orgId}/loads/1/pod-${crypto.randomUUID()}.jpg`
    await admin.storage.from('documents').upload(foreign, JPEG, { contentType: 'image/jpeg' })
    created.push(foreign)
    const { res, json } = await finalize(driver1Token, loadA, { type: 'pod', storage_path: foreign })
    expect(res.status).toBe(400)
    expect(json.error_code).toBe('VALIDATION_ERROR')
    const { data } = await admin.from('documents').select('id').eq('storage_path', foreign)
    expect(data).toHaveLength(0)
  })

  it('a path issued for one load cannot be attached to a different load', async () => {
    const otherLoad = await makeLoad(orgA.orgId, driver1Id)
    const i = await intent(driver1Token, loadA)
    created.push(i.json.storage_path)
    await putBytes(i.json.upload_url)
    const { res } = await finalize(driver1Token, otherLoad, { type: 'pod', storage_path: i.json.storage_path })
    expect(res.status).toBe(400)
  })

  it('nothing is recorded until the bytes exist (400 UPLOAD_NOT_FOUND) and no row is created', async () => {
    const i = await intent(driver1Token, loadA)
    created.push(i.json.storage_path)
    const { res } = await finalize(driver1Token, loadA, { type: 'pod', storage_path: i.json.storage_path })
    expect(res.status).toBe(400)
    const { data } = await admin.from('documents').select('id').eq('storage_path', i.json.storage_path)
    expect(data).toHaveLength(0)
  })
})

describe('idempotency', () => {
  it('replaying finalize with the same key returns the same document, one row', async () => {
    const i = await intent(driver1Token, loadA)
    created.push(i.json.storage_path)
    await putBytes(i.json.upload_url)
    const k = key()
    const a = await finalize(driver1Token, loadA, { type: 'pod', storage_path: i.json.storage_path }, k)
    const b = await finalize(driver1Token, loadA, { type: 'pod', storage_path: i.json.storage_path }, k)
    expect(b.json).toEqual(a.json)
    const { data } = await admin.from('documents').select('id').eq('storage_path', i.json.storage_path)
    expect(data).toHaveLength(1)
  })

  it('finalizing the same object under a DIFFERENT key still yields one row (natural-key idempotency)', async () => {
    const i = await intent(driver1Token, loadA)
    created.push(i.json.storage_path)
    await putBytes(i.json.upload_url)
    const a = await finalize(driver1Token, loadA, { type: 'pod', storage_path: i.json.storage_path })
    const b = await finalize(driver1Token, loadA, { type: 'pod', storage_path: i.json.storage_path })
    expect(b.json.id).toBe(a.json.id)
  })
})

describe('validation and authorization', () => {
  it.each([
    ['disallowed content type', { type: 'pod', content_type: 'text/plain', size_bytes: 10 }],
    ['oversize file', { type: 'pod', content_type: 'image/jpeg', size_bytes: 50 * 1024 * 1024 }],
    ['unknown document type', { type: 'contract', content_type: 'image/jpeg', size_bytes: 10 }],
  ])('rejects %s with 400', async (_l, body) => {
    expect((await intent(driver1Token, loadA, body)).res.status).toBe(400)
  })

  it('storage itself refuses a PUT whose Content-Type is not allowed', async () => {
    const i = await intent(driver1Token, loadA)
    created.push(i.json.storage_path)
    expect(await putBytes(i.json.upload_url, 'text/plain')).toBeGreaterThanOrEqual(400)
  })

  it('another driver, and another org, get 404 for every step', async () => {
    for (const token of [driver2Token, otherOwnerToken]) {
      expect((await intent(token, loadA)).res.status).toBe(404)
      expect((await finalize(token, loadA, { type: 'pod', storage_path: `${orgA.orgId}/loads/${loadA}/pod-${crypto.randomUUID()}.jpg` })).res.status).toBe(404)
      expect((await list(token, loadA)).res.status).toBe(404)
    }
  })

  it('list requires a known type and authentication', async () => {
    expect((await apiFetch(`/api/v1/loads/${loadA}/documents?type=nope`, driver1Token)).status).toBe(400)
    const res = await fetch(`${process.env.TEST_APP_URL ?? 'http://localhost:3000'}/api/v1/loads/${loadA}/documents?type=pod`)
    expect(res.status).toBe(401)
  })
})
