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
//
// customer_contacts/dvir_inspections/maintenance_reminders/vehicle_documents
// (added this session to close scripts/check-architecture.mjs's Rule L gap)
// follow the exact same carrier_org_id = my_org_id() shape for SELECT, read
// straight from supabase/migrations/0001_baseline_schema.sql +
// 0022_role_scoped_reads.sql (the latter is what actually left
// carrier_*_select's final form -- 0001's versions were superseded). See
// each describe block below for the specific policy asserted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg,
  type TestOrg, type TestUser,
} from './helpers'

const admin = adminClient()

let orgA: TestOrg, orgB: TestOrg
let custOrgA: TestOrg
let userA: TestUser, userB: TestUser
let sessionB: Awaited<ReturnType<typeof signInAs>>

let loadAId: number
let invoiceAId: number
let vehicleAId: number
let driverAId: number
let dvirAId: number
let maintenanceReminderAId: number
let vehicleDocAId: number
let customerContactAId: number

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

  // dvir_inspections (0001 L838 + 0022 L111 "carrier_dvir_select": SELECT
  // requires carrier_org_id = my_org_id()). vehicle_id/driver_id point at
  // orgA's own vehicle/driver created above.
  const { data: dvir } = await admin
    .from('dvir_inspections')
    .insert({ carrier_org_id: orgA.orgId, vehicle_id: vehicleAId, driver_id: driverAId, type: 'pre_trip', condition: 'satisfactory' })
    .select('id')
    .single()
  dvirAId = Number(dvir!.id)

  // maintenance_reminders (0001 L880 + 0022 L191 "carrier_reminders_select":
  // SELECT requires carrier_org_id = my_org_id()).
  const { data: reminder } = await admin
    .from('maintenance_reminders')
    .insert({ carrier_org_id: orgA.orgId, vehicle_id: vehicleAId, reminder_type: 'oil_change' })
    .select('id')
    .single()
  maintenanceReminderAId = Number(reminder!.id)

  // vehicle_documents (0001 L898 + 0022 L246 "carrier_vehicle_docs_select":
  // SELECT requires carrier_org_id = my_org_id()).
  const { data: vehicleDoc } = await admin
    .from('vehicle_documents')
    .insert({ carrier_org_id: orgA.orgId, vehicle_id: vehicleAId, doc_type: 'registration', storage_path: `test/${orgA.orgId}.pdf` })
    .select('id')
    .single()
  vehicleDocAId = Number(vehicleDoc!.id)

  // customer_contacts (0001 L1509 "carrier_customer_contacts_select": SELECT
  // requires carrier_org_id = my_org_id()). Needs a real customer org linked
  // to orgA via customer_details -- the enforce_contact_customer_tenancy
  // trigger (0019) rejects an org_id/carrier_org_id pair that customer_details
  // doesn't already have on file, same setup as tests/audit/roles-fixture.ts.
  custOrgA = await createTestOrg(admin, 'customer')
  await admin.from('customer_details').update({ carrier_org_id: orgA.orgId }).eq('org_id', custOrgA.orgId)
  const { data: contact } = await admin
    .from('customer_contacts')
    .insert({ org_id: custOrgA.orgId, carrier_org_id: orgA.orgId, name: 'Test Contact' })
    .select('id')
    .single()
  customerContactAId = Number(contact!.id)
})

afterAll(async () => {
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
  await cleanupTestOrg(admin, custOrgA.orgId)
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

  // dvir_inspections: carrier_dvir_select (SELECT) and owner_solo_dvir_all
  // (ALL) both gate on carrier_org_id = my_org_id() for an owner session --
  // the table ALSO has driver-scoped policies (driver_dvir_insert/modify,
  // keyed on driver_id = my_driver_id()) that this owner session never hits,
  // since it has no drivers row at all.
  it('dvir_inspections: org B session sees zero rows for org A inspection', async () => {
    const { data, error } = await sessionB.client.from('dvir_inspections').select('id').eq('id', dvirAId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('dvir_inspections: org B session cannot update org A inspection', async () => {
    const { data, error } = await sessionB.client
      .from('dvir_inspections')
      .update({ condition: 'defects_noted' })
      .eq('id', dvirAId)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([]) // RLS silently filters, doesn't error — 0 rows affected
    const { data: stillIntact } = await admin.from('dvir_inspections').select('condition').eq('id', dvirAId).single()
    expect(stillIntact?.condition).toBe('satisfactory')
  })

  // SECURITY REGRESSION (migration 0029): driver_dvir_insert/_modify originally checked ONLY
  // driver_id = my_driver_id() — a driver's own driver_id doesn't vary by which org a submitted row
  // claims, so any authenticated driver could INSERT (and UPDATE) a dvir_inspections row tagged with a
  // FOREIGN org's carrier_org_id, injecting a fabricated safety-inspection record into another
  // carrier's DVIR compliance history. Confirmed exploitable against a live instance before the fix
  // (raw REST POST with no .select()/RETURNING returned 201 and the row persisted, visible to the
  // victim org). Both policies now also require carrier_org_id = my_org_id() — this test proves that
  // holds and stays closed.
  describe('SECURITY REGRESSION — a driver cannot forge a dvir_inspections row into another org', () => {
    let driverB: TestUser
    let driverBSession: Awaited<ReturnType<typeof signInAs>>
    let driverBRowId: number
    let vehicleBId: number

    beforeAll(async () => {
      driverB = await createTestUser(admin, orgB.orgId, 'driver')
      driverBSession = await signInAs(driverB)
      const { data: row } = await admin
        .from('drivers')
        .insert({ carrier_org_id: orgB.orgId, profile_id: driverB.userId })
        .select('id')
        .single()
      driverBRowId = Number(row!.id)

      const { data: vehicleType } = await admin.from('vehicle_types').select('id').eq('code', 'semi').single()
      const { data: vehicle } = await admin
        .from('vehicles')
        .insert({ carrier_org_id: orgB.orgId, nickname: 'Org B Test Vehicle', vehicle_type_id: vehicleType!.id })
        .select('id')
        .single()
      vehicleBId = Number(vehicle!.id)
    })

    afterAll(async () => {
      await admin.from('drivers').delete().eq('id', driverBRowId)
      await admin.from('vehicles').delete().eq('id', vehicleBId)
    })

    it('a driver cannot INSERT an inspection tagged with a foreign carrier_org_id, even using their own driver_id', async () => {
      const { data, error } = await driverBSession.client
        .from('dvir_inspections')
        .insert({ carrier_org_id: orgA.orgId, vehicle_id: vehicleAId, driver_id: driverBRowId, type: 'pre_trip', condition: 'satisfactory' })
        .select()
      expect(data).toBeNull()
      expect(error).not.toBeNull()
      expect(error?.code).toBe('42501') // RLS violation, not a silent no-op

      // Confirm nothing leaked into org A regardless of the client-side error.
      const { data: leaked } = await admin.from('dvir_inspections').select('id').eq('carrier_org_id', orgA.orgId).eq('driver_id', driverBRowId)
      expect(leaked).toEqual([])
    })

    it('the same driver CAN still insert a legitimate inspection in their own org', async () => {
      const { data, error } = await driverBSession.client
        .from('dvir_inspections')
        .insert({ carrier_org_id: orgB.orgId, vehicle_id: vehicleBId, driver_id: driverBRowId, type: 'pre_trip', condition: 'satisfactory' })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
      if (data?.id) await admin.from('dvir_inspections').delete().eq('id', data.id)
    })
  })

  // maintenance_reminders: carrier_reminders_select (SELECT) and
  // owner_solo_reminders_all (ALL) both gate on carrier_org_id = my_org_id().
  it('maintenance_reminders: org B session sees zero rows for org A reminder', async () => {
    const { data, error } = await sessionB.client.from('maintenance_reminders').select('id').eq('id', maintenanceReminderAId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('maintenance_reminders: org B session cannot update org A reminder', async () => {
    const { data, error } = await sessionB.client
      .from('maintenance_reminders')
      .update({ reminder_type: 'hijacked' })
      .eq('id', maintenanceReminderAId)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])
    const { data: stillIntact } = await admin.from('maintenance_reminders').select('reminder_type').eq('id', maintenanceReminderAId).single()
    expect(stillIntact?.reminder_type).toBe('oil_change')
  })

  // vehicle_documents: carrier_vehicle_docs_select (SELECT) and
  // owner_solo_vehicle_docs_all (ALL) both gate on carrier_org_id = my_org_id().
  it('vehicle_documents: org B session sees zero rows for org A document', async () => {
    const { data, error } = await sessionB.client.from('vehicle_documents').select('id').eq('id', vehicleDocAId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('vehicle_documents: org B session cannot update org A document', async () => {
    const { data, error } = await sessionB.client
      .from('vehicle_documents')
      .update({ label: 'hijacked' })
      .eq('id', vehicleDocAId)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])
    const { data: stillIntact } = await admin.from('vehicle_documents').select('label').eq('id', vehicleDocAId).single()
    expect(stillIntact?.label).not.toBe('hijacked')
  })

  // customer_contacts: carrier_customer_contacts_select (SELECT) and
  // carrier_customer_contacts_write (ALL) both gate on carrier_org_id =
  // my_org_id() -- distinct from the *other* SELECT policy on this table,
  // portal_contact_own_row_select (portal_profile_id = auth.uid()), which
  // this test doesn't exercise since org B's owner has no portal_profile_id
  // link to this contact either way.
  it('customer_contacts: org B session sees zero rows for org A contact', async () => {
    const { data, error } = await sessionB.client.from('customer_contacts').select('id').eq('id', customerContactAId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('customer_contacts: org B session cannot update org A contact', async () => {
    const { data, error } = await sessionB.client
      .from('customer_contacts')
      .update({ name: 'hijacked' })
      .eq('id', customerContactAId)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])
    const { data: stillIntact } = await admin.from('customer_contacts').select('name').eq('id', customerContactAId).single()
    expect(stillIntact?.name).toBe('Test Contact')
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
