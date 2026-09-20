// tests/helpers.ts — shared setup/teardown for integration tests.
//
// Every test creates its OWN disposable org(s)/user(s) and tears them down
// afterward — never touches the persistent demo accounts
// (demo@carrieros.dev / Sierra Freight Co) documented in root CLAUDE.md,
// matching this project's stated preference for throwaway accounts in
// destructive testing.
//
// Cleanup order matters: profiles.org_id has NO `ON DELETE CASCADE` from
// organizations (confirmed by reading schema.sql directly — only
// carrier_details/customer_details do). Deleting the auth.users row first
// cascades to profiles (`profiles.id REFERENCES auth.users(id) ON DELETE
// CASCADE`); only then can the organizations row itself be deleted cleanly.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY)
}

let orgCounter = 0
// Date.now() alone collides across test FILES running in parallel (vitest's
// fileParallelism) — two files can both call this in the same millisecond
// with the same per-file counter value, producing the same email and a
// GoTrue 500 (duplicate key on users_email_partial_key). A short random
// component makes that collision astronomically unlikely without changing
// the human-readable timestamp prefix.
function uniqueSuffix() {
  orgCounter += 1
  return `${Date.now()}_${orgCounter}_${Math.random().toString(36).slice(2, 8)}`
}

export interface TestOrg {
  orgId: number
  type: 'carrier' | 'customer'
}

export async function createTestOrg(
  admin: SupabaseClient<Database>,
  type: 'carrier' | 'customer' = 'carrier',
  opts: { tier?: string } = {}
): Promise<TestOrg> {
  const suffix = uniqueSuffix()
  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .insert({ type, name: `Test Org ${suffix}` })
    .select('id')
    .single()
  if (orgErr || !org) throw new Error(`createTestOrg: ${orgErr?.message}`)

  if (type === 'carrier') {
    const { error } = await admin.from('carrier_details').insert({
      org_id: org.id,
      tier: opts.tier ?? 'starter',
    })
    if (error) throw new Error(`createTestOrg carrier_details: ${error.message}`)
  } else {
    const { error } = await admin.from('customer_details').insert({
      org_id: org.id,
      carrier_org_id: org.id, // placeholder; callers needing a real carrier link should update after
    })
    if (error) throw new Error(`createTestOrg customer_details: ${error.message}`)
  }

  return { orgId: Number(org.id), type }
}

export interface TestUser {
  userId: string
  email: string
  password: string
}

// Creates a real auth.users row + profiles row and returns credentials for
// a real sign-in — deliberately NOT the magic-link/OTP dance the app's own
// invite flows use (that's tested by the routes themselves); a password
// login is simpler and more reliable for automated test setup.
export async function createTestUser(
  admin: SupabaseClient<Database>,
  orgId: number,
  role: string
): Promise<TestUser> {
  const suffix = uniqueSuffix()
  const email = `test_${suffix}@carrieros-test.dev`
  const password = `Test${suffix}!Pass`

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr || !created.user) throw new Error(`createTestUser auth: ${createErr?.message}`)

  const { error: profileErr } = await admin.from('profiles').insert({
    id: created.user.id,
    org_id: orgId,
    role,
    first_name: 'Test',
    last_name: 'User',
  })
  if (profileErr) throw new Error(`createTestUser profile: ${profileErr.message}`)

  return { userId: created.user.id, email, password }
}

// Returns a session-scoped client (subject to RLS) for a test user, plus
// the raw access token for hitting API routes via Authorization: Bearer.
export async function signInAs(user: TestUser): Promise<{ client: SupabaseClient<Database>; accessToken: string }> {
  const anon = createClient<Database>(SUPABASE_URL, ANON_KEY)
  const { data, error } = await anon.auth.signInWithPassword({ email: user.email, password: user.password })
  if (error || !data.session) throw new Error(`signInAs: ${error?.message}`)

  const scoped = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  })
  return { client: scoped, accessToken: data.session.access_token }
}

export async function cleanupTestUser(admin: SupabaseClient<Database>, userId: string) {
  await admin.auth.admin.deleteUser(userId).catch(() => {})
}

// Full dependency graph pulled directly from pg_constraint (not guessed) —
// see tests/global-teardown.ts's header comment for the query used. Every
// table below has at least one "no action" (non-cascading) FK back to
// organizations, drivers, loads, or profiles that blocks deletion unless
// cleared first, in this order: org/driver/load-scoped rows that block
// `drivers`/`loads` themselves, then `drivers`/`loads`, then any remaining
// profiles(id) references, then `profiles`, then `organizations`.
const ORG_SCOPED_BLOCKERS = ['dvir_inspections', 'ifta_state_crossings', 'driver_settlements', 'fuel_stops', 'maintenance_reminders'] as const

// Every profiles(id) FK below is "no action" — none cascade. A live row in
// any of them blocks deleting the profile, which in turn blocks deleting
// the organization.
const PROFILE_REFERENCING_TABLES: { table: string; col: string }[] = [
  { table: 'drivers', col: 'profile_id' },
  { table: 'load_events', col: 'created_by' },
  { table: 'documents', col: 'uploaded_by' },
  { table: 'customer_contacts', col: 'portal_profile_id' },
  { table: 'service_logs', col: 'logged_by' },
  { table: 'vehicle_documents', col: 'uploaded_by' },
  { table: 'org_documents', col: 'uploaded_by' },
  { table: 'driver_documents', col: 'uploaded_by' },
  { table: 'fuel_stops', col: 'logged_by' },
  { table: 'load_expenses', col: 'logged_by' },
  { table: 'driver_messages', col: 'sender_id' },
  { table: 'driver_settlements', col: 'created_by' },
  { table: 'admin_notes', col: 'admin_id' },
  { table: 'admin_events', col: 'admin_id' },
  { table: 'org_flag_overrides', col: 'set_by' },
]

export async function cleanupTestOrg(admin: SupabaseClient<Database>, orgId: number) {
  // dvir_inspections/ifta_state_crossings/driver_settlements/fuel_stops all
  // have "no action" FKs to drivers AND loads (confirmed via pg_constraint)
  // — left in place, they block deleting this org's drivers/loads below.
  for (const table of ORG_SCOPED_BLOCKERS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from(table as any).delete().eq('carrier_org_id', orgId) as any)
  }
  // invoices_load_id_fkey / invoices_customer_org_id_fkey are both "no
  // action" — clear both directions (this org as carrier is cascade-safe,
  // but as the *customer* on someone else's invoice it isn't).
  await admin.from('invoices').delete().eq('carrier_org_id', orgId)
  await admin.from('invoices').delete().eq('customer_org_id', orgId)
  // documents_carrier_org_id_fkey / customer_contacts' two FKs are also "no
  // action" from organizations.
  await admin.from('documents').delete().eq('carrier_org_id', orgId)
  await admin.from('customer_contacts').delete().eq('carrier_org_id', orgId)
  await admin.from('customer_contacts').delete().eq('org_id', orgId)
  // customer_details.carrier_org_id has NO cascade (only org_id does) — a
  // 'customer'-type org can be referenced by another org's row via
  // carrier_org_id, which blocks deleting the referenced org otherwise.
  await admin.from('customer_details').delete().eq('org_id', orgId)
  await admin.from('customer_details').delete().eq('carrier_org_id', orgId)

  await admin.from('drivers').delete().eq('carrier_org_id', orgId)
  // loads_customer_org_id_fkey is "no action" — this org can appear as the
  // *customer* on another carrier's load, not just as the carrier itself.
  await admin.from('loads').delete().eq('carrier_org_id', orgId)
  await admin.from('loads').delete().eq('customer_org_id', orgId)

  const { data: remainingProfiles } = await admin.from('profiles').select('id').eq('org_id', orgId)
  const profileIds = (remainingProfiles ?? []).map((p) => p.id)
  if (profileIds.length > 0) {
    for (const { table, col } of PROFILE_REFERENCING_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from(table as any).delete().in(col, profileIds) as any)
    }
  }
  for (const p of remainingProfiles ?? []) {
    await admin.auth.admin.deleteUser(p.id).catch(() => {})
  }
  // Delete the profiles row directly too — a profile whose auth user was
  // already removed (e.g. a prior partial cleanup) would otherwise survive
  // deleteUser's no-op and block the organizations delete below.
  await admin.from('profiles').delete().eq('org_id', orgId)
  const { error: orgDeleteErr } = await admin.from('organizations').delete().eq('id', orgId)
  if (orgDeleteErr) {
    // Surface cleanup failures loudly instead of silently leaving test data
    // behind — this exact silent-failure shape is how two leaked test orgs
    // were found in the first place.
    console.error(`cleanupTestOrg(${orgId}) failed:`, orgDeleteErr.message)
  }
}

const BASE_URL = process.env.TEST_APP_URL ?? 'http://localhost:3000'

export async function apiFetch(path: string, accessToken: string, init: RequestInit = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })
}
