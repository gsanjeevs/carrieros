// Shared fixture for the roles-*.test.ts black-box audit probes. Everything is a
// throwaway org/user created via tests/helpers.ts and removed by teardown().
// Nothing here touches the persistent demo accounts.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import { adminClient, createTestOrg, createTestUser, signInAs, cleanupTestOrg, type TestUser } from '../helpers'

export interface Actor { user: TestUser; token: string; client: SupabaseClient; role: string; orgId: number }

export interface Fixture {
  admin: SupabaseClient
  orgA: number; orgB: number; custOrg: number; platformOrg: number
  a: Record<'owner' | 'dispatcher' | 'finance' | 'driver1' | 'driver2' | 'customer', Actor>
  b: Record<'owner' | 'driver', Actor>
  sx: Record<'owner' | 'finance' | 'support', Actor>
  ids: { loadA1: number; loadA2: number; loadB: number; invoiceA: number; invoiceB: number; vehicleB: number; driverA1: number; driverA2: number; driverB: number; docA: number; driverDocA2: number; expenseA: number; settlementA2: number }
  teardown: () => Promise<void>
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
export const anonClient = () => createClient(URL_, ANON)

async function actor(admin: SupabaseClient, orgId: number, role: string): Promise<Actor> {
  const user = await createTestUser(admin, orgId, role)
  const { client, accessToken } = await signInAs(user)
  return { user, token: accessToken, client: client as unknown as SupabaseClient, role, orgId }
}
// Test fixture: the typed client's .single() result is awkward to thread generically; rows are checked at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const must = (r: { data: any; error: { message: string } | null }, what: string): any => {
  if (r.error || r.data === null) throw new Error(`${what}: ${r.error?.message}`)
  return r.data
}

export async function setup(): Promise<Fixture> {
  const admin = adminClient() as unknown as SupabaseClient
  const orgA = (await createTestOrg(admin as never, 'carrier', { tier: 'pro' })).orgId
  const orgB = (await createTestOrg(admin as never, 'carrier', { tier: 'pro' })).orgId
  const custOrg = (await createTestOrg(admin as never, 'customer')).orgId
  await admin.from('customer_details').update({ carrier_org_id: orgA }).eq('org_id', custOrg)
  const platformOrg = Number(must(await admin.from('organizations').insert({ type: 'platform', name: `AuditPlatform ${Date.now()}` }).select('id').single(), 'platform org').id)

  const a = {
    owner: await actor(admin, orgA, 'owner'), dispatcher: await actor(admin, orgA, 'dispatcher'),
    finance: await actor(admin, orgA, 'finance'), driver1: await actor(admin, orgA, 'driver'),
    driver2: await actor(admin, orgA, 'driver'), customer: await actor(admin, custOrg, 'customer_viewer'),
  }
  const b = { owner: await actor(admin, orgB, 'owner'), driver: await actor(admin, orgB, 'driver') }
  const sx = { owner: await actor(admin, platformOrg, 'sx_owner'), finance: await actor(admin, platformOrg, 'sx_finance'), support: await actor(admin, platformOrg, 'sx_support') }

  const mkDriver = async (org: number, uid: string) => Number(must(await admin.from('drivers').insert({ carrier_org_id: org, profile_id: uid }).select('id').single(), 'driver').id)
  const driverA1 = await mkDriver(orgA, a.driver1.user!.userId)
  const driverA2 = await mkDriver(orgA, a.driver2.user!.userId)
  const driverB = await mkDriver(orgB, b.driver.user!.userId)
  const mkLoad = async (org: number, driver: number | null, cust: number | null, n: string) =>
    Number(must(await admin.from('loads').insert({ carrier_org_id: org, load_number: `AUD-${n}-${Date.now()}`, status: 'dispatched', driver_id: driver, customer_org_id: cust, rate: 4321 }).select('id').single(), 'load').id)
  const loadA1 = await mkLoad(orgA, driverA1, custOrg, 'A1')
  const loadA2 = await mkLoad(orgA, driverA2, null, 'A2')
  const loadB = await mkLoad(orgB, driverB, null, 'B')
  const inv = async (org: number, load: number, cust: number | null, n: string) =>
    Number(must(await admin.from('invoices').insert({ carrier_org_id: org, load_id: load, customer_org_id: cust, invoice_number: `AINV-${n}-${Date.now()}`, amount: 999, status: 'sent' }).select('id').single(), 'invoice').id)
  const invoiceA = await inv(orgA, loadA1, custOrg, 'A')
  const invoiceB = await inv(orgB, loadB, null, 'B')
  const { data: vt } = await admin.from('vehicle_types').select('id').limit(1).single()
  const vehicleB = Number(must(await admin.from('vehicles').insert({ carrier_org_id: orgB, vehicle_number: `AV-${Date.now()}`, nickname: 'B truck', vehicle_type_id: vt!.id }).select('id').single(), 'vehicle').id)
  const docA = Number(must(await admin.from('documents').insert({ carrier_org_id: orgA, load_id: loadA2, storage_path: 'audit/none.pdf', type: 'bol', uploaded_by: a.owner.user!.userId }).select('id').single(), 'doc').id)
  const driverDocA2 = Number(must(await admin.from('driver_documents').insert({ carrier_org_id: orgA, driver_id: driverA2, doc_type: 'cdl_scan', storage_path: 'audit/cdl.pdf', uploaded_by: a.owner.user!.userId }).select('id').single(), 'driver doc').id)
  const expenseA = Number(must(await admin.from('load_expenses').insert({ carrier_org_id: orgA, load_id: loadA2, expense_type: 'fuel', amount: 55, logged_by: a.owner.user!.userId }).select('id').single(), 'expense').id)
  const settlementA2 = Number(must(await admin.from('driver_settlements').insert({ carrier_org_id: orgA, driver_id: driverA2, pay_method: 'per_mile', gross_revenue: 1000, net_pay: 800 }).select('id').single(), 'settlement').id)

  return {
    admin, orgA, orgB, custOrg, platformOrg, a, b, sx,
    ids: { loadA1, loadA2, loadB, invoiceA, invoiceB, vehicleB, driverA1, driverA2, driverB, docA, driverDocA2, expenseA, settlementA2 },
    teardown: async () => {
      await admin.from('idempotency_keys').delete().in('org_id', [orgA, orgB])
      await admin.from('driver_documents').delete().in('carrier_org_id', [orgA, orgB])
      await admin.from('load_expenses').delete().in('carrier_org_id', [orgA, orgB])
      await admin.from('vehicles').delete().in('carrier_org_id', [orgA, orgB])
      await admin.from('driver_messages').delete().in('carrier_org_id', [orgA, orgB])
      await admin.from('driver_messages').delete().in('sender_id', [a.driver1.user!.userId, a.driver2.user!.userId, b.driver.user!.userId])
      for (const o of [orgA, orgB, custOrg, platformOrg]) await cleanupTestOrg(admin as never, o)
    },
  }
}
export const rows = (r: { data: unknown[] | null }) => (r.data ?? []).length
