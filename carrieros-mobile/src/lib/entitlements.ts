// src/lib/entitlements.ts
// ADR 0003: no direct .rpc() calls from UI code. Backed now by
// GET /api/v1/me/entitlements, which the server answers from the same
// get_my_entitlements() RPC this file used to call directly (see that
// route's header comment) — same result, same "the caller's own tier"
// scoping, just reached over the shared API instead of the Supabase SDK.
//
// The `supabase` parameter is kept (unused) so the existing call sites in
// customers/[id].tsx, settlements/index.tsx, ifta-section.tsx and
// ifta-summary.tsx — owned by other in-flight work — do not need to change.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { apiClient } from '@/lib/api-client';

export async function hasFeature(_supabase: SupabaseClient<Database>, featureKey: string): Promise<boolean> {
  const { data } = await apiClient.http.GET('/api/v1/me/entitlements');
  return (data?.keys ?? []).includes(featureKey);
}

export async function getEntitlements(_supabase: SupabaseClient<Database>): Promise<Set<string>> {
  const { data } = await apiClient.http.GET('/api/v1/me/entitlements');
  return new Set(data?.keys ?? []);
}
