// src/lib/entitlements.ts
// Mirrors carrieros-web/lib/entitlements.ts — same has_feature()/
// get_my_entitlements() RPCs, same caller-session-client requirement (never
// pass the admin/service-role client; my_org_id() needs auth.uid()). No
// shared package exists between the two apps' TS setups (see
// docs/architecture-principles.md Rule A), so this is a deliberate, small
// duplication of a thin wrapper rather than a service-role dependency —
// same "mirror with a cross-reference comment" precedent already used for
// i18n (decisions.md T10).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export async function hasFeature(supabase: SupabaseClient<Database>, featureKey: string): Promise<boolean> {
  const { data } = await supabase.rpc('has_feature', { feature_key: featureKey });
  return data === true;
}

export async function getEntitlements(supabase: SupabaseClient<Database>): Promise<Set<string>> {
  const { data } = await supabase.rpc('get_my_entitlements');
  return new Set((data ?? []).map((row: { key: string }) => row.key));
}
