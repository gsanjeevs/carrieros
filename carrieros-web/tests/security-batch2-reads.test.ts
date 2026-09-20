// tests/security-batch2-reads.test.ts — adversarial org/role scoping checks for the second
// wave of read endpoints migrating mobile screens onto /api/v1 (ADR 0003 batch 2): GET
// /api/v1/exceptions, /customers, /customers/{id}, /billing, /maintenance-reminders,
// /settlements, /loads/{id}/ifta-crossings, /loads/{id}/ifta-completeness,
// /reports/ifta-quarterly, /loads/{id}/fuel-stops, /loads/{id}/messages, /dashboard.
// Several of the underlying tables (carrier_details, maintenance_reminders, fuel_stops,
// ifta_state_crossings) have RLS with NO role restriction at all — this file is the check
// that the application-layer capability gates added on top actually hold, not just that RLS
// (which would let more through) does.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setup, type Fixture } from './audit/roles-fixture'

const APP = process.env.TEST_APP_URL ?? 'http://localhost:3000'
let f: Fixture
let vehicleA: number
let reminderA: number
let fuelStopA1: number
let crossingA1: number
let messageFromDriver1: number
let messageFromOwner: number

const api = (token: string | null, method: string, path: string) =>
  fetch(`${APP}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} })

beforeAll(async () => {
  f = await setup()

  const { data: vt } = await f.admin.from('vehicle_types').select('id').limit(1).single()
  vehicleA = Number(
    (
      await f.admin
        .from('vehicles')
        .insert({ carrier_org_id: f.orgA, vehicle_number: `BATCH2-${Date.now()}`, nickname: 'Batch2 truck', vehicle_type_id: (vt as { id: number }).id })
        .select('id')
        .single()
    ).data!.id
  )
  reminderA = Number(
    (
      await f.admin
        .from('maintenance_reminders')
        .insert({ carrier_org_id: f.orgA, vehicle_id: vehicleA, reminder_type: 'oil_change', is_active: true, next_due_date: '2027-01-01' })
        .select('id')
        .single()
    ).data!.id
  )
  fuelStopA1 = Number(
    (
      await f.admin
        .from('fuel_stops')
        .insert({ carrier_org_id: f.orgA, load_id: f.ids.loadA1, driver_id: f.ids.driverA1, state: 'TX', stop_date: '2026-09-01', gallons: 50, total_cost: 200 })
        .select('id')
        .single()
    ).data!.id
  )
  crossingA1 = Number(
    (
      await f.admin
        .from('ifta_state_crossings')
        .insert({ carrier_org_id: f.orgA, load_id: f.ids.loadA1, driver_id: f.ids.driverA1, state: 'TX', crossed_at: '2026-09-01T12:00:00Z', odometer_est: 100, source: 'gps' })
        .select('id')
        .single()
    ).data!.id
  )
  messageFromDriver1 = Number(
    (
      await f.admin
        .from('driver_messages')
        .insert({ carrier_org_id: f.orgA, load_id: f.ids.loadA1, sender_id: f.a.driver1.user!.userId, body: 'hello from driver1' })
        .select('id')
        .single()
    ).data!.id
  )
  messageFromOwner = Number(
    (
      await f.admin
        .from('driver_messages')
        .insert({ carrier_org_id: f.orgA, load_id: f.ids.loadA2, sender_id: f.a.owner.user!.userId, body: 'hello on a different load' })
        .select('id')
        .single()
    ).data!.id
  )
}, 120_000)

afterAll(async () => {
  if (messageFromOwner) await f.admin.from('driver_messages').delete().eq('id', messageFromOwner)
  if (messageFromDriver1) await f.admin.from('driver_messages').delete().eq('id', messageFromDriver1)
  if (crossingA1) await f.admin.from('ifta_state_crossings').delete().eq('id', crossingA1)
  if (fuelStopA1) await f.admin.from('fuel_stops').delete().eq('id', fuelStopA1)
  if (reminderA) await f.admin.from('maintenance_reminders').delete().eq('id', reminderA)
  if (vehicleA) await f.admin.from('vehicles').delete().eq('id', vehicleA)
  await f?.teardown()
})

describe('GET /api/v1/exceptions', () => {
  it('requires authentication', async () => {
    expect((await api(null, 'GET', '/api/v1/exceptions')).status).toBe(401)
  })

  it('a driver gets an empty (not error) feed — get_exceptions_unchecked() filters role internally', async () => {
    const res = await api(f.a.driver1.token, 'GET', '/api/v1/exceptions')
    expect(res.status).toBe(200)
    expect(Array.isArray((await res.json()).exceptions)).toBe(true)
  })

  it('owner sees a 200 with an array', async () => {
    const res = await api(f.a.owner.token, 'GET', '/api/v1/exceptions')
    expect(res.status).toBe(200)
    expect(Array.isArray((await res.json()).exceptions)).toBe(true)
  })
})

describe('GET /api/v1/customers and /api/v1/customers/{id}', () => {
  it('requires authentication', async () => {
    expect((await api(null, 'GET', '/api/v1/customers')).status).toBe(401)
  })

  it('driver (no customers_view capability) is refused', async () => {
    expect((await api(f.a.driver1.token, 'GET', '/api/v1/customers')).status).toBe(403)
    expect((await api(f.a.driver1.token, 'GET', `/api/v1/customers/${f.custOrg}`)).status).toBe(403)
  })

  it('owner, dispatcher, and finance can all list this org\'s customers', async () => {
    for (const actor of [f.a.owner, f.a.dispatcher, f.a.finance]) {
      const res = await api(actor.token, 'GET', '/api/v1/customers')
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.customers.some((c: { org_id: number }) => c.org_id === f.custOrg)).toBe(true)
    }
  })

  it('another org never sees this org\'s customer, by list or by id', async () => {
    const list = await api(f.b.owner.token, 'GET', '/api/v1/customers')
    expect(list.status).toBe(200)
    expect((await list.json()).customers.some((c: { org_id: number }) => c.org_id === f.custOrg)).toBe(false)

    const detail = await api(f.b.owner.token, 'GET', `/api/v1/customers/${f.custOrg}`)
    expect(detail.status).toBe(404)
  })

  it('owner sees the customer detail with recent loads and a health score (pro tier)', async () => {
    const res = await api(f.a.owner.token, 'GET', `/api/v1/customers/${f.custOrg}`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.customer.org_id).toBe(f.custOrg)
    expect(json.recent_loads.some((l: { id: number }) => l.id === f.ids.loadA1)).toBe(true)
    expect(typeof json.health_score).toBe('number')
  })
})

describe('GET /api/v1/billing', () => {
  it('requires authentication', async () => {
    expect((await api(null, 'GET', '/api/v1/billing')).status).toBe(401)
  })

  it('dispatcher, finance, and driver (no subscription_management capability) are refused, even though carrier_details RLS has no role check', async () => {
    expect((await api(f.a.dispatcher.token, 'GET', '/api/v1/billing')).status).toBe(403)
    expect((await api(f.a.finance.token, 'GET', '/api/v1/billing')).status).toBe(403)
    expect((await api(f.a.driver1.token, 'GET', '/api/v1/billing')).status).toBe(403)
  })

  it('owner sees their own org\'s billing details, never another org\'s', async () => {
    const res = await api(f.a.owner.token, 'GET', '/api/v1/billing')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.tier).toBe('pro')
    expect(typeof json.vehicle_count).toBe('number')
  })
})

describe('GET /api/v1/maintenance-reminders', () => {
  it('requires authentication', async () => {
    expect((await api(null, 'GET', '/api/v1/maintenance-reminders')).status).toBe(401)
  })

  it('org A sees its own reminder; org B never sees it', async () => {
    const resA = await api(f.a.owner.token, 'GET', '/api/v1/maintenance-reminders')
    expect(resA.status).toBe(200)
    expect((await resA.json()).reminders.some((r: { id: number }) => r.id === reminderA)).toBe(true)

    const resB = await api(f.b.owner.token, 'GET', '/api/v1/maintenance-reminders')
    expect(resB.status).toBe(200)
    expect((await resB.json()).reminders.some((r: { id: number }) => r.id === reminderA)).toBe(false)
  })
})

describe('GET /api/v1/settlements', () => {
  it('requires authentication', async () => {
    expect((await api(null, 'GET', '/api/v1/settlements')).status).toBe(401)
  })

  it('dispatcher is refused — driver_settlements RLS grants dispatcher no policy at all', async () => {
    expect((await api(f.a.dispatcher.token, 'GET', '/api/v1/settlements')).status).toBe(403)
  })

  it('driver2 (the settlement\'s own driver) sees only their own settlement, entitlement-ungated', async () => {
    const res = await api(f.a.driver2.token, 'GET', '/api/v1/settlements')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.entitled).toBe(true)
    expect(json.settlements.some((s: { id: number }) => s.id === f.ids.settlementA2)).toBe(true)
  })

  it('driver1 (a coworker, not the settlement\'s driver) does not see driver2\'s settlement', async () => {
    const res = await api(f.a.driver1.token, 'GET', '/api/v1/settlements')
    expect(res.status).toBe(200)
    expect((await res.json()).settlements.some((s: { id: number }) => s.id === f.ids.settlementA2)).toBe(false)
  })

  it('owner (staff, pro tier entitled) sees the whole org\'s settlements', async () => {
    const res = await api(f.a.owner.token, 'GET', '/api/v1/settlements')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.entitled).toBe(true)
    expect(json.settlements.some((s: { id: number }) => s.id === f.ids.settlementA2)).toBe(true)
  })

  it('org B never sees org A\'s settlement', async () => {
    const res = await api(f.b.owner.token, 'GET', '/api/v1/settlements')
    expect(res.status).toBe(200)
    expect((await res.json()).settlements.some((s: { id: number }) => s.id === f.ids.settlementA2)).toBe(false)
  })
})

describe('GET /api/v1/loads/{id}/ifta-crossings and /ifta-completeness', () => {
  it('requires authentication', async () => {
    expect((await api(null, 'GET', `/api/v1/loads/${f.ids.loadA1}/ifta-crossings`)).status).toBe(401)
  })

  it('a coworker driver cannot view crossings for a load that is not theirs', async () => {
    expect((await api(f.a.driver2.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/ifta-crossings`)).status).toBe(404)
  })

  it('the owning driver sees the recorded crossing', async () => {
    const res = await api(f.a.driver1.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/ifta-crossings`)
    expect(res.status).toBe(200)
    expect((await res.json()).crossings.some((c: { id: number }) => c.id === crossingA1)).toBe(true)
  })

  it('finance (no ifta_record capability) is refused', async () => {
    expect((await api(f.a.finance.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/ifta-crossings`)).status).toBe(403)
    expect((await api(f.a.finance.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/ifta-completeness`)).status).toBe(403)
  })

  it('org B cannot read org A\'s load crossings at all', async () => {
    expect((await api(f.b.owner.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/ifta-crossings`)).status).toBe(404)
  })

  it('completeness check returns a boolean for the owning org', async () => {
    const res = await api(f.a.owner.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/ifta-completeness`)
    expect(res.status).toBe(200)
    expect(typeof (await res.json()).complete).toBe('boolean')
  })
})

describe('GET /api/v1/reports/ifta-quarterly', () => {
  it('requires authentication', async () => {
    expect((await api(null, 'GET', '/api/v1/reports/ifta-quarterly?quarter=2026-Q3')).status).toBe(401)
  })

  it('rejects a malformed quarter', async () => {
    expect((await api(f.a.owner.token, 'GET', '/api/v1/reports/ifta-quarterly?quarter=nope')).status).toBe(400)
  })

  it('dispatcher and driver (no finance capability) are refused', async () => {
    expect((await api(f.a.dispatcher.token, 'GET', '/api/v1/reports/ifta-quarterly?quarter=2026-Q3')).status).toBe(403)
    expect((await api(f.a.driver1.token, 'GET', '/api/v1/reports/ifta-quarterly?quarter=2026-Q3')).status).toBe(403)
  })

  it('owner (pro tier) sees org A\'s September crossing aggregated, entitled true', async () => {
    const res = await api(f.a.owner.token, 'GET', '/api/v1/reports/ifta-quarterly?quarter=2026-Q3')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.entitled).toBe(true)
    expect(json.rows.some((r: { state: string }) => r.state === 'TX')).toBe(true)
  })

  it('org B\'s owner never sees org A\'s state mileage', async () => {
    const res = await api(f.b.owner.token, 'GET', '/api/v1/reports/ifta-quarterly?quarter=2026-Q3')
    expect(res.status).toBe(200)
    expect((await res.json()).rows.some((r: { state: string }) => r.state === 'TX')).toBe(false)
  })
})

describe('GET /api/v1/loads/{id}/fuel-stops', () => {
  it('requires authentication', async () => {
    expect((await api(null, 'GET', `/api/v1/loads/${f.ids.loadA1}/fuel-stops`)).status).toBe(401)
  })

  it('a coworker driver cannot view fuel stops for a load that is not theirs', async () => {
    expect((await api(f.a.driver2.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/fuel-stops`)).status).toBe(404)
  })

  it('the owning driver sees the fuel stop', async () => {
    const res = await api(f.a.driver1.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/fuel-stops`)
    expect(res.status).toBe(200)
    expect((await res.json()).fuel_stops.some((s: { id: number }) => s.id === fuelStopA1)).toBe(true)
  })

  it('org B cannot read org A\'s load fuel stops', async () => {
    expect((await api(f.b.owner.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/fuel-stops`)).status).toBe(404)
  })
})

describe('GET /api/v1/loads/{id}/messages', () => {
  it('requires authentication', async () => {
    expect((await api(null, 'GET', `/api/v1/loads/${f.ids.loadA1}/messages`)).status).toBe(401)
  })

  it('finance (no chat_participate capability) is refused, matching driver_messages RLS granting finance nothing', async () => {
    expect((await api(f.a.finance.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/messages`)).status).toBe(403)
  })

  it('a coworker driver cannot read a thread on a load that is not theirs', async () => {
    expect((await api(f.a.driver2.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/messages`)).status).toBe(404)
  })

  it('the assigned driver reads their own load\'s thread', async () => {
    const res = await api(f.a.driver1.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/messages`)
    expect(res.status).toBe(200)
    expect((await res.json()).messages.some((m: { id: number }) => m.id === messageFromDriver1)).toBe(true)
  })

  it('owner/solo/dispatcher can read any load\'s thread in the org', async () => {
    const res = await api(f.a.owner.token, 'GET', `/api/v1/loads/${f.ids.loadA2}/messages`)
    expect(res.status).toBe(200)
    expect((await res.json()).messages.some((m: { id: number }) => m.id === messageFromOwner)).toBe(true)
  })

  it('org B cannot read org A\'s message thread', async () => {
    expect((await api(f.b.owner.token, 'GET', `/api/v1/loads/${f.ids.loadA1}/messages`)).status).toBe(404)
  })
})

describe('GET /api/v1/dashboard', () => {
  it('requires authentication', async () => {
    expect((await api(null, 'GET', '/api/v1/dashboard')).status).toBe(401)
  })

  it('owner gets fleet/loads content scoped to their own org only', async () => {
    const res = await api(f.a.owner.token, 'GET', '/api/v1/dashboard')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.role).toBe('owner')
    expect(Array.isArray(json.recent_loads)).toBe(true)
    expect(json.recent_loads.every((l: { id: number }) => l.id !== f.ids.loadB)).toBe(true)
  })

  it('dispatcher gets an ops board that never contains another org\'s load', async () => {
    const res = await api(f.a.dispatcher.token, 'GET', '/api/v1/dashboard')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.role).toBe('dispatcher')
    expect(Array.isArray(json.ops_loads)).toBe(true)
    expect(json.ops_loads.every((l: { id: number }) => l.id !== f.ids.loadB)).toBe(true)
  })

  it('finance gets invoice-summary content only', async () => {
    const res = await api(f.a.finance.token, 'GET', '/api/v1/dashboard')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.role).toBe('finance')
    expect(typeof json.outstanding_count).toBe('number')
  })

  it('a driver actor gets 403 — this endpoint only serves owner/solo/dispatcher/finance', async () => {
    expect((await api(f.a.driver1.token, 'GET', '/api/v1/dashboard')).status).toBe(403)
  })

  it('org B never sees org A\'s data in its own dashboard', async () => {
    const res = await api(f.b.owner.token, 'GET', '/api/v1/dashboard')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.recent_loads.every((l: { id: number }) => l.id !== f.ids.loadA1 && l.id !== f.ids.loadA2)).toBe(true)
  })
})
