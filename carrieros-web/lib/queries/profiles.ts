// lib/queries/profiles.ts
// Rule B of docs/architecture-principles.md — profiles is the single most
// duplicated raw query in this codebase (56 separate `.from('profiles')`
// call sites at the time this was written). getProfileForUser() below is
// the exact "org_id, role" shape ~20 of those call sites hand-wrote
// identically (API-route authz context, mostly) — a schema change to
// profiles' shape now only needs to touch this one function, not be grepped
// across every route handler.
//
// Not a full repository/ORM layer (Rule B is explicit about this) — this
// only covers the shapes actually reused today, not a query for every
// column combination that theoretically exists.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type AnySupabaseClient = SupabaseClient<Database> | ReturnType<typeof import('@supabase/supabase-js').createClient<Database>>

// Used for authz context (org scoping + role gating) — the shape nearly
// every API route needs immediately after resolving the caller's identity.
// Deliberately does NOT filter is_active (unlike my_org_id()/my_role()'s SQL
// equivalents) — callers that need the deactivated-user-fails-closed
// behavior should check `is_active` on the returned row themselves, same as
// the call sites being migrated onto this already did.
//
// Widened (2026-07-24, Rule B sweep) to a superset covering every page/route
// that just needs "my own profile row" regardless of which specific columns
// it reads — org_id/role plus the personal-prefs columns several pages also
// read (first/last name, locale/uom/date/time prefs, timezone). A page that
// doesn't use every column just ignores the extras; cheaper than 25 near-
// identical hand-written selects.
const PROFILE_SELF_COLUMNS =
  'id, org_id, role, is_active, first_name, last_name, preferred_language, uom_system, date_format, time_format, timezone'

export async function getProfileForUser(supabase: AnySupabaseClient, userId: string) {
  return supabase
    .from('profiles')
    .select(PROFILE_SELF_COLUMNS)
    .eq('id', userId)
    .single()
}

// Cross-user lookup (an admin/team-manager viewing SOMEONE ELSE's profile),
// distinct from getProfileForUser's "my own row" shape above. maybeSingle,
// not single — callers need to distinguish "not found" from an error.
export async function getProfileById(supabase: AnySupabaseClient, targetId: string) {
  return supabase
    .from('profiles')
    .select('id, org_id, role, first_name, last_name, is_active')
    .eq('id', targetId)
    .maybeSingle()
}

// Team roster — every profile in an org, for the team management page/API.
export async function listProfilesForOrg(supabase: AnySupabaseClient, orgId: number) {
  return supabase
    .from('profiles')
    .select('id, first_name, last_name, role, is_active, preferred_language, phone, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
}

export async function updateProfilePreferences(
  supabase: AnySupabaseClient,
  userId: string,
  prefs: { preferred_language?: string; uom_system?: string; date_format?: string; time_format?: string }
) {
  return supabase.from('profiles').update(prefs).eq('id', userId)
}

// Bulk cross-org variant (service-role admin surfaces only — SuperAdmin
// pipeline/org-detail pages listing profiles across many tenant orgs).
export async function listProfilesForOrgs(supabase: AnySupabaseClient, orgIds: number[]) {
  return supabase
    .from('profiles')
    .select('id, first_name, last_name, role, org_id')
    .in('org_id', orgIds)
}

// Owners/solos for an org — used both by the impersonate-as-owner admin
// action and the reminder cron (both want "who can act as this org's
// primary account").
// Single owner/solo lookup for the impersonate-as-owner admin action —
// deliberately separate from getOrgOwnersAndSolos() below since it needs
// .limit(1).maybeSingle() rather than a full list.
export async function getOrgOwnerOrSolo(supabase: AnySupabaseClient, orgId: number) {
  return supabase
    .from('profiles')
    .select('id')
    .eq('org_id', orgId)
    .in('role', ['owner', 'solo'])
    .limit(1)
    .maybeSingle()
}

export async function getOrgOwnersAndSolos(supabase: AnySupabaseClient, orgId: number) {
  return supabase
    .from('profiles')
    .select('id, first_name, last_name, role')
    .eq('org_id', orgId)
    .in('role', ['owner', 'solo'])
}

export async function countOrgAdmins(supabase: AnySupabaseClient, orgId: number) {
  return supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .in('role', ['owner', 'solo'])
}

export async function updateProfileRole(supabase: AnySupabaseClient, profileId: string, role: string) {
  return supabase.from('profiles').update({ role }).eq('id', profileId)
}

export async function setProfileActive(supabase: AnySupabaseClient, profileId: string, isActive: boolean) {
  return supabase.from('profiles').update({ is_active: isActive }).eq('id', profileId)
}

export async function insertProfile(
  supabase: AnySupabaseClient,
  profile: {
    id: string
    org_id: number
    role: string
    first_name?: string | null
    last_name?: string | null
    phone?: string | null
  }
) {
  return supabase.from('profiles').insert(profile)
}

export async function upsertProfile(
  supabase: AnySupabaseClient,
  profile: {
    id: string
    org_id: number
    role: string
    first_name?: string | null
    last_name?: string | null
  }
) {
  return supabase.from('profiles').upsert(profile, { onConflict: 'id' })
}
