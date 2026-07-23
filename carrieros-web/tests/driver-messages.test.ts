// tests/driver-messages.test.ts
// Gate 0->1 coverage gap closed (docs/production-gates.md) — driver_chat
// feature gating, the dispatch-vs-assigned-driver access check
// (app/api/driver-messages/route.ts and .../[id]/translate/route.ts both
// implement the same explicit-check-on-top-of-RLS convention as
// app/api/team/[id]/route.ts), the original_language fallback chain, and
// the translate-cache dedup (unique on message_id + target_language).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch,
  type TestOrg, type TestUser,
} from './helpers'

const admin = adminClient()

async function insertDriver(orgId: number, profileId: string, driverNumber: string) {
  const { data, error } = await admin
    .from('drivers')
    .insert({ carrier_org_id: orgId, profile_id: profileId, driver_number: driverNumber, invite_status: 'accepted' })
    .select('id')
    .single()
  if (error || !data) throw new Error(`insertDriver: ${error?.message}`)
  return data.id
}

describe('POST /api/driver-messages', () => {
  let org: TestOrg
  let dispatcher: TestUser
  let finance: TestUser
  let assignedDriverUser: TestUser
  let otherDriverUser: TestUser
  let dispatcherSession: Awaited<ReturnType<typeof signInAs>>
  let financeSession: Awaited<ReturnType<typeof signInAs>>
  let assignedDriverSession: Awaited<ReturnType<typeof signInAs>>
  let otherDriverSession: Awaited<ReturnType<typeof signInAs>>
  let loadId: number

  beforeAll(async () => {
    org = await createTestOrg(admin, 'carrier', { tier: 'growth' })
    dispatcher = await createTestUser(admin, org.orgId, 'dispatcher')
    finance = await createTestUser(admin, org.orgId, 'finance')
    assignedDriverUser = await createTestUser(admin, org.orgId, 'driver')
    otherDriverUser = await createTestUser(admin, org.orgId, 'driver')
    dispatcherSession = await signInAs(dispatcher)
    financeSession = await signInAs(finance)
    assignedDriverSession = await signInAs(assignedDriverUser)
    otherDriverSession = await signInAs(otherDriverUser)

    const assignedDriverId = await insertDriver(org.orgId, assignedDriverUser.userId, `DM-A-${Date.now()}`)
    await insertDriver(org.orgId, otherDriverUser.userId, `DM-B-${Date.now()}`)

    const { data: load, error } = await admin
      .from('loads')
      .insert({ carrier_org_id: org.orgId, load_number: `DM-L-${Date.now()}`, driver_id: assignedDriverId, status: 'dispatched' })
      .select('id')
      .single()
    if (error || !load) throw new Error(`load insert: ${error?.message}`)
    loadId = load.id
  })

  afterAll(async () => {
    await cleanupTestOrg(admin, org.orgId)
  })

  it('rejects finance (not a dispatch role and not the assigned driver)', async () => {
    const res = await apiFetch('/api/driver-messages', financeSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ load_id: loadId, body: 'hello' }),
    })
    expect(res.status).toBe(403)
  })

  it('rejects a driver not assigned to the load (404, not 403 — RLS on loads hides its existence entirely from a driver with no relationship to it, before the route\'s own access check ever runs)', async () => {
    const res = await apiFetch('/api/driver-messages', otherDriverSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ load_id: loadId, body: 'hello' }),
    })
    expect(res.status).toBe(404)
  })

  it('allows the assigned driver, and original_language falls back through the chain to carrier default', async () => {
    await admin.from('carrier_details').update({ default_language: 'es' }).eq('org_id', org.orgId)

    const res = await apiFetch('/api/driver-messages', assignedDriverSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ load_id: loadId, body: 'on my way' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()

    const { data: message } = await admin
      .from('driver_messages')
      .select('original_language')
      .eq('id', body.id)
      .single()
    expect(message?.original_language).toBe('es')
  })

  it('allows a dispatcher, and original_language uses their own preferred_language over the carrier default', async () => {
    await admin.from('profiles').update({ preferred_language: 'en' }).eq('id', dispatcher.userId)

    const res = await apiFetch('/api/driver-messages', dispatcherSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ load_id: loadId, body: 'confirmed' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()

    const { data: message } = await admin
      .from('driver_messages')
      .select('original_language')
      .eq('id', body.id)
      .single()
    expect(message?.original_language).toBe('en')
  })

  it('rejects when driver_chat is not entitled (Starter tier)', async () => {
    await admin.from('carrier_details').update({ tier: 'starter' }).eq('org_id', org.orgId)

    const res = await apiFetch('/api/driver-messages', dispatcherSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ load_id: loadId, body: 'blocked' }),
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error_code).toBe('TIER_UPGRADE_REQUIRED')

    // Restore for any tests that run after this file if suite order changes.
    await admin.from('carrier_details').update({ tier: 'growth' }).eq('org_id', org.orgId)
  })
})

describe('POST /api/driver-messages/:id/translate', () => {
  let org: TestOrg
  let dispatcher: TestUser
  let dispatcherSession: Awaited<ReturnType<typeof signInAs>>
  let messageId: number

  beforeAll(async () => {
    org = await createTestOrg(admin, 'carrier', { tier: 'growth' })
    dispatcher = await createTestUser(admin, org.orgId, 'dispatcher')
    dispatcherSession = await signInAs(dispatcher)

    const driverUser = await createTestUser(admin, org.orgId, 'driver')
    const driverId = await insertDriver(org.orgId, driverUser.userId, `DM-T-${Date.now()}`)
    const { data: load } = await admin
      .from('loads')
      .insert({ carrier_org_id: org.orgId, load_number: `DM-TL-${Date.now()}`, driver_id: driverId, status: 'dispatched' })
      .select('id')
      .single()

    const { data: message } = await admin
      .from('driver_messages')
      .insert({ carrier_org_id: org.orgId, load_id: load!.id, sender_id: dispatcher.userId, body: 'need an update', original_language: 'en' })
      .select('id')
      .single()
    messageId = message!.id
  })

  afterAll(async () => {
    await cleanupTestOrg(admin, org.orgId)
  })

  it('rejects an unsupported target_language', async () => {
    const res = await apiFetch(`/api/driver-messages/${messageId}/translate`, dispatcherSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ target_language: 'zz' }),
    })
    expect(res.status).toBe(400)
  })

  it('translates and caches, and a second call for the same target_language does not insert a duplicate row', async () => {
    const first = await apiFetch(`/api/driver-messages/${messageId}/translate`, dispatcherSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ target_language: 'es' }),
    })
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody.translated_body).toContain('es')

    const second = await apiFetch(`/api/driver-messages/${messageId}/translate`, dispatcherSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ target_language: 'es' }),
    })
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.translated_body).toBe(firstBody.translated_body)

    const { count } = await admin
      .from('driver_message_translations')
      .select('id', { count: 'exact', head: true })
      .eq('message_id', messageId)
      .eq('target_language', 'es')
    expect(count).toBe(1)
  })
})
