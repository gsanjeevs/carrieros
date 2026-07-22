// tests/loads.test.ts
// Gate 0→1 — the core entity lifecycle: create a load via the real API
// route (POST /api/loads, atomic entity numbering via next_entity_val()),
// then transition its status via PATCH (including 'cancelled', Phase 3A).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch,
  type TestOrg, type TestUser,
} from './helpers'

const admin = adminClient()
let org: TestOrg
let owner: TestUser
let session: Awaited<ReturnType<typeof signInAs>>

beforeAll(async () => {
  org = await createTestOrg(admin, 'carrier')
  owner = await createTestUser(admin, org.orgId, 'owner')
  session = await signInAs(owner)
})

afterAll(async () => {
  await cleanupTestOrg(admin, org.orgId)
})

describe('load lifecycle', () => {
  let loadId: number
  let loadNumber: string

  it('POST /api/loads creates a draft load with an atomic load_number', async () => {
    const res = await apiFetch('/api/loads', session.accessToken, {
      method: 'POST',
      body: JSON.stringify({ customer_name_raw: 'Test Customer', commodity: 'Steel', rate: 1500 }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.load_number).toMatch(/^L-\d+$/)
    loadNumber = body.load_number

    // load_number is unique per-org (next_entity_val()), not globally — must
    // filter by carrier_org_id too, or .single() errors on multiple matches
    // across other orgs' data (e.g. the persistent demo org already has L-1).
    const { data: row } = await admin
      .from('loads')
      .select('id, status, carrier_org_id')
      .eq('load_number', loadNumber)
      .eq('carrier_org_id', org.orgId)
      .single()
    expect(row?.status).toBe('draft')
    expect(row?.carrier_org_id).toBe(org.orgId)
    loadId = Number(row!.id)
  })

  it('two concurrent creates never collide on load_number (next_entity_val race safety)', async () => {
    const [a, b] = await Promise.all([
      apiFetch('/api/loads', session.accessToken, { method: 'POST', body: JSON.stringify({ commodity: 'A' }) }),
      apiFetch('/api/loads', session.accessToken, { method: 'POST', body: JSON.stringify({ commodity: 'B' }) }),
    ])
    const [bodyA, bodyB] = await Promise.all([a.json(), b.json()])
    expect(bodyA.load_number).not.toBe(bodyB.load_number)
  })

  it('PATCH transitions status through the pipeline, logging a load_event each time', async () => {
    for (const status of ['scheduled', 'dispatched', 'picked_up', 'in_transit', 'delivered']) {
      const res = await apiFetch(`/api/loads/${loadId}`, session.accessToken, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      expect(res.status).toBe(200)
    }
    const { data: row } = await admin.from('loads').select('status').eq('id', loadId).single()
    expect(row?.status).toBe('delivered')

    const { data: events } = await admin.from('load_events').select('event_type').eq('load_id', loadId)
    expect(events?.map(e => e.event_type)).toContain('status_delivered')
  })

  it('PATCH rejects an invalid status value', async () => {
    const res = await apiFetch(`/api/loads/${loadId}`, session.accessToken, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'not_a_real_status' }),
    })
    expect(res.status).toBe(400)
  })

  it("PATCH to 'cancelled' works from an in-progress state (Phase 3A)", async () => {
    const res = await apiFetch(`/api/loads/${loadId}`, session.accessToken, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled' }),
    })
    expect(res.status).toBe(200)
    const { data: row } = await admin.from('loads').select('status').eq('id', loadId).single()
    expect(row?.status).toBe('cancelled')
  })
})
