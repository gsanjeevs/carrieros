// lib/entitlements.ts
// Thin wrapper around the has_feature() RLS-usable RPC (decisions.md S11 /
// Phase 0F). MUST be called with the CALLER's own session-scoped Supabase
// client, never the admin/service-role client — the admin client has no
// JWT/auth.uid() context, so my_org_id() (which has_feature() depends on)
// would resolve to null and every check would silently fail closed.
//
// Enforcement lives here (server-side, API route/page guard) or directly in
// an RLS policy — a hidden nav item or disabled button is never the actual
// gate, just a UX nicety pairing with this check.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

export async function hasFeature(
  supabase: SupabaseClient<Database>,
  featureKey: string
): Promise<boolean> {
  const { data } = await supabase.rpc('has_feature', { feature_key: featureKey })
  return data === true
}

// Full set of feature keys the caller's org currently has, in one round trip
// — the primitive for data-driven menus/actions. Fetch this ONCE (e.g. in a
// layout/server component) and render nav items / buttons from
// `entitlements.has('driver_chat')` rather than hardcoding tier logic or a
// feature list in component code. The source of truth stays the `features`/
// `tiers` tables — this is just a batched read of the same has_feature()
// logic, not a second copy of it.
export async function getEntitlements(supabase: SupabaseClient<Database>): Promise<Set<string>> {
  const { data } = await supabase.rpc('get_my_entitlements')
  return new Set((data ?? []).map(row => row.key))
}
