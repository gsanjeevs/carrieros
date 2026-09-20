// A driver's RLS policy on loads allows UPDATE of any column (row-level security cannot restrict columns).
// Migration 0018's trigger restricts a DRIVER to status + location. These tests go straight at PostgREST with
// the driver's own JWT, i.e. exactly what a modified client could do, to prove the hole is closed and the
// legitimate paths still work.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, type TestOrg } from './helpers'
import type { Database } from '@/types/supabase'

const admin = adminClient()
let org: TestOrg
let driverClient: SupabaseClient<Database>
let ownerClient: SupabaseClient<Database>
let dispatcherClient: SupabaseClient<Database>
let loadId: number

const row = async () => (await admin.from('loads').select('status, rate, driver_id, carrier_org_id, customer_name_raw, last_location_lat').eq('id', loadId).single()).data!

beforeAll(async () => {
  org = await createTestOrg(admin, 'carrier')
  const driver = await createTestUser(admin, org.orgId, 'driver')
  const owner = await createTestUser(admin, org.orgId, 'owner')
  const dispatcher = await createTestUser(admin, org.orgId, 'dispatcher')
  const driverId = Number((await admin.from('drivers').insert({ carrier_org_id: org.orgId, profile_id: driver.userId }).select('id').single()).data!.id)
  loadId = Number((await admin.from('loads').insert({ carrier_org_id: org.orgId, load_number: `DC-${Date.now()}`, status: 'dispatched', rate: 1000, driver_id: driverId, customer_name_raw: 'Acme' }).select('id').single()).data!.id)
  driverClient = (await signInAs(driver)).client
  ownerClient = (await signInAs(owner)).client
  dispatcherClient = (await signInAs(dispatcher)).client
})

afterAll(async () => {
  await cleanupTestOrg(admin, org.orgId)
})

describe('drivers can change status and location, nothing else', () => {
  it('may update status and the location columns', async () => {
    const { error } = await driverClient.from('loads').update({ status: 'picked_up', last_location_lat: 39.5, last_location_lng: -119.8, last_location_at: new Date().toISOString() }).eq('id', loadId)
    expect(error).toBeNull()
    expect(await row()).toMatchObject({ status: 'picked_up', last_location_lat: 39.5 })
  })

  it.each([
    ['rate', { rate: 999999 }],
    ['assigned driver', { driver_id: null }],
    ['customer', { customer_name_raw: 'Evil Corp' }],
    ['organization', { carrier_org_id: 1 }],
    ['rate hidden inside an otherwise-legal update', { status: 'delivered', rate: 1 }],
  ])('cannot change %s (even alongside allowed columns)', async (_l, patch) => {
    const before = await row()
    const { error } = await driverClient.from('loads').update(patch as never).eq('id', loadId)
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
    expect(await row()).toEqual(before) // nothing changed, including the status in the mixed case
  })
})

describe('everyone else is unaffected', () => {
  it('owner and dispatcher may still edit the rate; the service role too', async () => {
    expect((await ownerClient.from('loads').update({ rate: 1100 }).eq('id', loadId)).error).toBeNull()
    expect((await dispatcherClient.from('loads').update({ rate: 1200 }).eq('id', loadId)).error).toBeNull()
    expect((await admin.from('loads').update({ rate: 1300 }).eq('id', loadId)).error).toBeNull()
    expect((await row()).rate).toBe(1300)
  })
})
