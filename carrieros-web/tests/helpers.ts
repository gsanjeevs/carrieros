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
function uniqueSuffix() {
  orgCounter += 1
  return `${Date.now()}_${orgCounter}`
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

export async function cleanupTestOrg(admin: SupabaseClient<Database>, orgId: number) {
  // Order matters — found two real FK blockers the hard way, not guessed:
  // 1. `drivers.profile_id` has NO cascade from profiles -> drivers first.
  // 2. `load_events.created_by` ALSO has no cascade from profiles, so a
  //    profile that ever PATCHed a load's status (which logs a load_event)
  //    can't be deleted while those events exist. `load_events.load_id`
  //    DOES cascade from loads, so deleting this org's loads directly
  //    (before deleting profiles) clears load_events as a side effect.
  // Only once profiles are gone is `organizations` safe to delete (which
  // cascades whatever's left: vehicles/invoices/carrier_details/etc).
  // NOTE: other profiles(id)-referencing "actor" columns exist elsewhere
  // (admin_notes.admin_id, admin_events.admin_id, org_flag_overrides.set_by)
  // — not hit by this test suite's current scope (regular tenant users,
  // not ShipmentX admins), but the same class of bug if that changes.
  await admin.from('drivers').delete().eq('carrier_org_id', orgId)
  await admin.from('loads').delete().eq('carrier_org_id', orgId)

  const { data: remainingProfiles } = await admin.from('profiles').select('id').eq('org_id', orgId)
  for (const p of remainingProfiles ?? []) {
    await admin.auth.admin.deleteUser(p.id).catch(() => {})
  }
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
