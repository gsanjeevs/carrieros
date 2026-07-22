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
export async function getProfileForUser(supabase: AnySupabaseClient, userId: string) {
  return supabase
    .from('profiles')
    .select('id, org_id, role, is_active')
    .eq('id', userId)
    .single()
}
