// tests/rls-isolation.test.ts
// Gate 0→1 (docs/production-gates.md) — the highest-priority automated
// coverage this codebase has been missing: every cross-tenant isolation
// check this session did was manual, run once, by hand. This suite makes
// it a real, repeatable regression test instead.
//
// Tests two orgs (A, B), each with their own owner user, and confirm B's
// session can never read or write A's rows on the "hot" tables identified
// in docs/architecture-principles.md (loads, invoices, vehicles, drivers)
// plus the Phase 8 platform-admin tables (which must deny ALL non-sx_*
// sessions, not just other tenants).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg,
  type TestOrg, type TestUser,
} from './helpers'

const admin = adminClient()

let orgA: TestOrg, orgB: TestOrg
let userA: TestUser, userB: TestUser
let sessionB: Awaited<ReturnType<typeof signInAs>>

let loadAId: number
let invoiceAId: number
let vehicleAId: number
let driverAId: number

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier')
  orgB = await createTestOrg(admin, 'carrier')
  userA = await createTestUser(admin, orgA.orgId, 'owner')
  userB = await createTestUser(admin, orgB.orgId, 'owner')
  sessionB = await signInAs(userB)

  const { data: load } = await admin
    .from('loads')
    .insert({ carrier_org_id: orgA.orgId, load_number: `TEST-${orgA.orgId}` })
    .select('id')
    .single()
  loadAId = Number(load!.id)

  const { data: invoice } = await admin
    .from('invoices')
    .insert({ carrier_org_id: orgA.orgId, invoice_number: `INV-TEST-${orgA.orgId}`, amount: 100 })
    .select('id')
    .single()
  invoiceAId = Number(invoice!.id)

  const { data: vehicleType } = await admin.from('vehicle_types').select('id').eq('code', 'semi').single()
  const { data: vehicle } = await admin
    .from('vehicles')
    .insert({ carrier_org_id: orgA.orgId, nickname: 'Test Vehicle', vehicle_type_id: vehicleType!.id })
    .select('id')
    .single()
  vehicleAId = Number(vehicle!.id)

  const { data: driver } = await admin
    .from('drivers')
    .insert({ carrier_org_id: orgA.orgId, profile_id: userA.userId })
    .select('id')
    .single()
  driverAId = Number(driver!.id)
})

afterAll(async () => {
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
})

describe('cross-tenant isolation — org B cannot see org A data', () => {
  it('loads: org B session sees zero rows for org A load, even by direct id', async () => {
    const { data, error } = await sessionB.client.from('loads').select('id').eq('id', loadAId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('loads: org B session cannot update org A load', async () => {
    const { data, error } = await sessionB.client
      .from('loads')
      .update({ commodity: 'hijacked' })
      .eq('id', loadAId)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([]) // RLS silently filters, doesn't error — 0 rows affected
    const { data: stillIntact } = await admin.from('loads').select('commodity').eq('id', loadAId).single()
    expect(stillIntact?.commodity).not.toBe('hijacked')
  })

  it('invoices: org B session sees zero rows for org A invoice', async () => {
    const { data, error } = await sessionB.client.from('invoices').select('id').eq('id', invoiceAId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('vehicles: org B session sees zero rows for org A vehicle', async () => {
    const { data, error } = await sessionB.client.from('vehicles').select('id').eq('id', vehicleAId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('drivers: org B session sees zero rows for org A driver', async () => {
    const { data, error } = await sessionB.client.from('drivers').select('id').eq('id', driverAId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("org B's own queries (no filter) never include org A's rows", async () => {
    const { data } = await sessionB.client.from('loads').select('id')
    expect(data?.some(l => l.id === loadAId)).toBe(false)
  })
})

describe('platform-admin tables deny every non-ShipmentX session (Phase 8, SECTION 3c)', () => {
  const tables = ['admin_notes', 'admin_events', 'billing_events', 'platform_flags', 'org_flag_overrides'] as const

  for (const table of tables) {
    it(`${table}: a regular carrier session sees zero rows`, async () => {
      const { data, error } = await sessionB.client.from(table).select('*')
      expect(error).toBeNull()
      expect(data).toEqual([])
    })
  }
})
