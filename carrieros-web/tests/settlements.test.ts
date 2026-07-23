// tests/settlements.test.ts
// Gate 0->1 coverage gap closed (docs/production-gates.md) — driver
// settlement creation/ACH role+tier gating and the real pay-rate
// calculation (app/api/settlements/run/route.ts: gross_revenue is always
// the summed loads.rate for the period; net_pay applies the driver's
// settlement_type/settlement_rate — percent_of_rate, per_mile, or
// flat_per_load).
//
// NOTE: IFTA-completeness (check_ifta_completeness()) is a separate,
// unrelated feature — it's wired into app/api/loads/[id]/route.ts's PATCH
// (informational field on the delivered transition), not settlements. An
// earlier research pass this session assumed it belonged here and was
// wrong; corrected before writing these tests rather than testing for a
// feature that was never supposed to be here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, apiFetch,
  type TestOrg, type TestUser,
} from './helpers'

const admin = adminClient()

describe('POST /api/settlements/run', () => {
  let org: TestOrg
  let owner: TestUser
  let dispatcher: TestUser
  let ownerSession: Awaited<ReturnType<typeof signInAs>>
  let dispatcherSession: Awaited<ReturnType<typeof signInAs>>
  let driverId: number

  beforeAll(async () => {
    org = await createTestOrg(admin, 'carrier', { tier: 'growth' })
    owner = await createTestUser(admin, org.orgId, 'owner')
    dispatcher = await createTestUser(admin, org.orgId, 'dispatcher')
    ownerSession = await signInAs(owner)
    dispatcherSession = await signInAs(dispatcher)

    const driverUser = await createTestUser(admin, org.orgId, 'driver')
    const { data: driver, error } = await admin
      .from('drivers')
      .insert({
        carrier_org_id: org.orgId,
        profile_id: driverUser.userId,
        driver_number: `ST-${Date.now()}`,
        invite_status: 'accepted',
        settlement_type: 'percent_of_rate',
        settlement_rate: 10,
      })
      .select('id')
      .single()
    if (error || !driver) throw new Error(`settlements test setup: ${error?.message}`)
    driverId = driver.id
  })

  afterAll(async () => {
    await cleanupTestOrg(admin, org.orgId)
  })

  it('rejects a dispatcher (owner/solo/finance only, matches the RLS policy)', async () => {
    const res = await apiFetch('/api/settlements/run', dispatcherSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ driver_id: driverId, period_start: '2026-07-01', period_end: '2026-07-15' }),
    })
    expect(res.status).toBe(403)
  })

  it('rejects a driver_id with no settlement_type configured', async () => {
    const bareDriverUser = await createTestUser(admin, org.orgId, 'driver')
    const { data: bareDriver } = await admin
      .from('drivers')
      .insert({ carrier_org_id: org.orgId, profile_id: bareDriverUser.userId, driver_number: `ST-BARE-${Date.now()}`, invite_status: 'accepted' })
      .select('id')
      .single()

    const res = await apiFetch('/api/settlements/run', ownerSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ driver_id: bareDriver!.id, period_start: '2026-07-01', period_end: '2026-07-15' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error_code).toBe('VALIDATION_ERROR')
  })

  it('rejects a driver with settlement_type but no settlement_rate configured', async () => {
    const noRateUser = await createTestUser(admin, org.orgId, 'driver')
    const { data: noRateDriver } = await admin
      .from('drivers')
      .insert({ carrier_org_id: org.orgId, profile_id: noRateUser.userId, driver_number: `ST-NORATE-${Date.now()}`, invite_status: 'accepted', settlement_type: 'per_mile' })
      .select('id')
      .single()

    const res = await apiFetch('/api/settlements/run', ownerSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ driver_id: noRateDriver!.id, period_start: '2026-07-01', period_end: '2026-07-15' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error_code).toBe('VALIDATION_ERROR')
  })

  it('per_mile: net_pay = total delivered-period miles * settlement_rate', async () => {
    const perMileUser = await createTestUser(admin, org.orgId, 'driver')
    const { data: perMileDriver } = await admin
      .from('drivers')
      .insert({ carrier_org_id: org.orgId, profile_id: perMileUser.userId, driver_number: `ST-MILE-${Date.now()}`, invite_status: 'accepted', settlement_type: 'per_mile', settlement_rate: 0.6 })
      .select('id')
      .single()

    await admin.from('loads').insert({
      carrier_org_id: org.orgId,
      driver_id: perMileDriver!.id,
      load_number: `ST-MILE-L-${Date.now()}`,
      status: 'delivered',
      rate: 1000,
      total_miles: 500,
      delivery_date: '2026-07-05',
    })

    const res = await apiFetch('/api/settlements/run', ownerSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ driver_id: perMileDriver!.id, period_start: '2026-07-01', period_end: '2026-07-15' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()

    const { data: settlement } = await admin
      .from('driver_settlements')
      .select('gross_revenue, net_pay, rate_value')
      .eq('id', body.id)
      .single()
    expect(Number(settlement?.gross_revenue)).toBe(1000)
    expect(Number(settlement?.net_pay)).toBe(300) // 500 mi * $0.60
    expect(Number(settlement?.rate_value)).toBe(0.6)
  })

  it('happy path (percent_of_rate): gross_revenue is the summed load rate, net_pay applies the driver\'s settlement_rate', async () => {
    const loadRows = [
      { rate: 1000, delivery_date: '2026-07-05' },
      { rate: 1500, delivery_date: '2026-07-10' },
      // Outside the period — must not be counted.
      { rate: 9999, delivery_date: '2026-06-01' },
    ]
    let n = 0
    for (const row of loadRows) {
      n += 1
      const { error } = await admin.from('loads').insert({
        carrier_org_id: org.orgId,
        driver_id: driverId,
        load_number: `ST-L-${Date.now()}-${n}`,
        status: 'delivered',
        rate: row.rate,
        delivery_date: row.delivery_date,
      })
      if (error) throw new Error(`load insert: ${error.message}`)
    }

    const res = await apiFetch('/api/settlements/run', ownerSession.accessToken, {
      method: 'POST',
      body: JSON.stringify({ driver_id: driverId, period_start: '2026-07-01', period_end: '2026-07-15' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()

    const { data: settlement } = await admin
      .from('driver_settlements')
      .select('gross_revenue, net_pay, loads_count, payment_status, rate_value')
      .eq('id', body.id)
      .single()
    expect(Number(settlement?.gross_revenue)).toBe(2500)
    expect(Number(settlement?.net_pay)).toBe(250) // 2500 * 10%
    expect(settlement?.loads_count).toBe(2)
    expect(settlement?.payment_status).toBe('pending')
    expect(Number(settlement?.rate_value)).toBe(10)
  })
})

describe('POST /api/settlements/:id/send-ach', () => {
  let org: TestOrg
  let owner: TestUser
  let ownerSession: Awaited<ReturnType<typeof signInAs>>
  let settlementId: number

  beforeAll(async () => {
    // 'growth' unlocks driver_settlements but NOT settlement_ach (Pro+) —
    // deliberately proves the two feature gates are independent of each
    // other, not just "any paid tier passes both."
    org = await createTestOrg(admin, 'carrier', { tier: 'growth' })
    owner = await createTestUser(admin, org.orgId, 'owner')
    ownerSession = await signInAs(owner)

    const achDriverUser = await createTestUser(admin, org.orgId, 'driver')
    const { data: driver } = await admin
      .from('drivers')
      .insert({ carrier_org_id: org.orgId, profile_id: achDriverUser.userId, driver_number: `ST-ACH-${Date.now()}`, invite_status: 'accepted', settlement_type: 'flat_per_load' })
      .select('id')
      .single()

    const { data: settlement } = await admin
      .from('driver_settlements')
      .insert({
        carrier_org_id: org.orgId,
        driver_id: driver!.id,
        pay_method: 'flat_per_load',
        gross_revenue: 500,
        net_pay: 500,
        payment_status: 'pending',
      })
      .select('id')
      .single()
    settlementId = settlement!.id
  })

  afterAll(async () => {
    await cleanupTestOrg(admin, org.orgId)
  })

  it('rejects a Growth-tier org (driver_settlements is unlocked, settlement_ach requires Pro)', async () => {
    const res = await apiFetch(`/api/settlements/${settlementId}/send-ach`, ownerSession.accessToken, {
      method: 'POST',
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error_code).toBe('TIER_UPGRADE_REQUIRED')
  })

  it('allows a Pro-tier org and flips payment_status to sent', async () => {
    await admin.from('carrier_details').update({ tier: 'pro' }).eq('org_id', org.orgId)

    const res = await apiFetch(`/api/settlements/${settlementId}/send-ach`, ownerSession.accessToken, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payment_status).toBe('sent')
  })
})
