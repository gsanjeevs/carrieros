// POST /api/v1/loads/{id}/milestones — the command path that replaces mobile's
// two separate writes (loads.status, then load_events). The SQL function under
// it bypasses RLS, so these tests are what prove the APPLICATION layer enforces
// who may do what: driver-only-own-load, no cross-tenant, no finance, legal
// transitions, idempotency, and optimistic concurrency.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch,
  type TestOrg,
} from './helpers'

const admin = adminClient()
let orgA: TestOrg
let orgB: TestOrg
let ownerToken: string
let financeToken: string
let driver1Token: string
let driver2Token: string
let otherOwnerToken: string
let driver1Id: number

let n = 0
const key = () => `test-key-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`

async function makeLoad(orgId: number, status: string, driverId: number | null = null) {
  const { data, error } = await admin
    .from('loads')
    .insert({ carrier_org_id: orgId, load_number: `MS-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, status, driver_id: driverId })
    .select('id')
    .single()
  if (error || !data) throw new Error(`makeLoad: ${error?.message}`)
  return Number(data.id)
}

async function advance(token: string, loadId: number, body: Record<string, unknown>, idem: string | null = key()) {
  const res = await apiFetch(`/api/v1/loads/${loadId}/milestones`, token, {
    method: 'POST',
    headers: idem ? { 'Idempotency-Key': idem } : {},
    body: JSON.stringify(body),
  })
  return { res, body: await res.json() }
}

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier')
  orgB = await createTestOrg(admin, 'carrier')
  const owner = await createTestUser(admin, orgA.orgId, 'owner')
  const finance = await createTestUser(admin, orgA.orgId, 'finance')
  const d1 = await createTestUser(admin, orgA.orgId, 'driver')
  const d2 = await createTestUser(admin, orgA.orgId, 'driver')
  const otherOwner = await createTestUser(admin, orgB.orgId, 'owner')

  const mk = async (profileId: string) => {
    const { data, error } = await admin.from('drivers').insert({ carrier_org_id: orgA.orgId, profile_id: profileId }).select('id').single()
    if (error || !data) throw new Error(`driver insert: ${error?.message}`)
    return Number(data.id)
  }
  driver1Id = await mk(d1.userId)
  await mk(d2.userId) // a second driver in the same org, to prove drivers can't touch each other's loads

  ownerToken = (await signInAs(owner)).accessToken
  financeToken = (await signInAs(finance)).accessToken
  driver1Token = (await signInAs(d1)).accessToken
  driver2Token = (await signInAs(d2)).accessToken
  otherOwnerToken = (await signInAs(otherOwner)).accessToken
})

afterAll(async () => {
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
})

describe('happy path and atomicity', () => {
  it('advances status and writes the timeline event, audit row and outbox event together', async () => {
    const id = await makeLoad(orgA.orgId, 'dispatched')
    const idem = key()
    const { res, body } = await advance(ownerToken, id, { expected_status: 'dispatched', new_status: 'picked_up', reason: 'left the yard' }, idem)
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ outcome: 'APPLIED', load_id: id, status: 'picked_up' })

    const { data: load } = await admin.from('loads').select('status').eq('id', id).single()
    expect(load?.status).toBe('picked_up')
    const { data: events } = await admin.from('load_events').select('event_type, note').eq('load_id', id)
    expect(events).toEqual([{ event_type: 'status_picked_up', note: 'left the yard' }])
    const { data: audit } = await admin.from('audit_events').select('action, prior_state, new_state').eq('aggregate_id', String(id))
    expect(audit).toEqual([{ action: 'shipment.milestone.submitted', prior_state: 'dispatched', new_state: 'picked_up' }])
    const { data: outbox } = await admin.from('outbox_events').select('event_type').eq('idempotency_key', idem)
    expect(outbox).toEqual([{ event_type: 'MilestoneSubmitted' }])
  })

  it('works without expected_status (advances from whatever the server holds)', async () => {
    const id = await makeLoad(orgA.orgId, 'picked_up')
    const { res, body } = await advance(ownerToken, id, { new_status: 'in_transit' })
    expect(res.status).toBe(200)
    expect(body.status).toBe('in_transit')
  })
})

describe('idempotency and concurrency', () => {
  it('replaying the same key returns REPLAYED and does not apply twice', async () => {
    const id = await makeLoad(orgA.orgId, 'dispatched')
    const idem = key()
    const first = await advance(ownerToken, id, { expected_status: 'dispatched', new_status: 'picked_up' }, idem)
    const replay = await advance(ownerToken, id, { expected_status: 'dispatched', new_status: 'picked_up' }, idem)
    expect(first.body.outcome).toBe('APPLIED')
    expect(replay.res.status).toBe(200)
    expect(replay.body.outcome).toBe('REPLAYED')
    const { data: events } = await admin.from('load_events').select('id').eq('load_id', id)
    expect(events).toHaveLength(1)
  })

  it('a stale expected_status is a 409 that reports the current status', async () => {
    const id = await makeLoad(orgA.orgId, 'dispatched')
    await advance(ownerToken, id, { expected_status: 'dispatched', new_status: 'picked_up' })
    const { res, body } = await advance(ownerToken, id, { expected_status: 'dispatched', new_status: 'in_transit' })
    expect(res.status).toBe(409)
    expect(body.error_code).toBe('VERSION_CONFLICT')
    expect(body.meta.current_status).toBe('picked_up')
  })
})

describe('validation', () => {
  it('rejects an illegal transition with 409 ILLEGAL_TRANSITION and changes nothing', async () => {
    const id = await makeLoad(orgA.orgId, 'draft')
    const { res, body } = await advance(ownerToken, id, { expected_status: 'draft', new_status: 'delivered' })
    expect(res.status).toBe(409)
    expect(body.error_code).toBe('ILLEGAL_TRANSITION')
    const { data: load } = await admin.from('loads').select('status').eq('id', id).single()
    expect(load?.status).toBe('draft')
  })

  it('rejects billing/termination statuses on this path with 400', async () => {
    const id = await makeLoad(orgA.orgId, 'delivered')
    const { res, body } = await advance(ownerToken, id, { expected_status: 'delivered', new_status: 'invoiced' })
    expect(res.status).toBe(400)
    expect(body.error_code).toBe('VALIDATION_ERROR')
  })

  it('requires an Idempotency-Key', async () => {
    const id = await makeLoad(orgA.orgId, 'dispatched')
    const { res, body } = await advance(ownerToken, id, { new_status: 'picked_up' }, null)
    expect(res.status).toBe(400)
    expect(body.error_code).toBe('VALIDATION_ERROR')
  })
})

describe('who may advance which load', () => {
  it('a driver can advance their own load', async () => {
    const id = await makeLoad(orgA.orgId, 'dispatched', driver1Id)
    const { res } = await advance(driver1Token, id, { expected_status: 'dispatched', new_status: 'picked_up' })
    expect(res.status).toBe(200)
  })

  it('a driver cannot advance another driver\'s load (404, not 403: no existence leak)', async () => {
    const id = await makeLoad(orgA.orgId, 'dispatched', driver1Id)
    const { res, body } = await advance(driver2Token, id, { expected_status: 'dispatched', new_status: 'picked_up' })
    expect(res.status).toBe(404)
    expect(body.error_code).toBe('NOT_FOUND')
    const { data: load } = await admin.from('loads').select('status').eq('id', id).single()
    expect(load?.status).toBe('dispatched')
  })

  it('another organization\'s owner gets 404 and changes nothing', async () => {
    const id = await makeLoad(orgA.orgId, 'dispatched')
    const { res } = await advance(otherOwnerToken, id, { expected_status: 'dispatched', new_status: 'picked_up' })
    expect(res.status).toBe(404)
    const { data: load } = await admin.from('loads').select('status').eq('id', id).single()
    expect(load?.status).toBe('dispatched')
  })

  it('finance may not advance a shipment', async () => {
    const id = await makeLoad(orgA.orgId, 'dispatched')
    const { res, body } = await advance(financeToken, id, { expected_status: 'dispatched', new_status: 'picked_up' })
    expect(res.status).toBe(403)
    expect(body.error_code).toBe('FORBIDDEN')
  })

  it('requires authentication', async () => {
    const res = await fetch(`${process.env.TEST_APP_URL ?? 'http://localhost:3000'}/api/v1/loads/1/milestones`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key(), 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(401)
  })
})

