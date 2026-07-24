// lib/queries/drivers.ts
// Rule B of docs/architecture-principles.md — same posture as
// lib/queries/profiles.ts and loads.ts: covers reused query shapes for the
// `drivers` table only, not a full repository layer.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type AnySupabaseClient = SupabaseClient<Database> | ReturnType<typeof import('@supabase/supabase-js').createClient<Database>>

// "Which drivers row belongs to the signed-in user" — the single most
// duplicated drivers shape (loads list, DriverView, SoloView dashboards,
// driver-messages routes all resolve this identically). Widened (Rule B
// sweep) to include cdl_expiry/med_cert_expiry too — DriverView's own
// compliance-status card needs those off the same row, and the extra
// columns are harmless for callers that only care about `id`.
export async function getDriverIdForProfile(supabase: AnySupabaseClient, profileId: string) {
  return supabase
    .from('drivers')
    .select('id, carrier_org_id, default_vehicle_id, cdl_expiry, med_cert_expiry')
    .eq('profile_id', profileId)
    .maybeSingle()
}

// Driver roster shape — widened (Rule B sweep) to a superset covering every
// page/route that lists an org's active drivers regardless of which
// specific columns it reads: the drivers table page, the driver-invite API
// listing, and the settlements page's driver picker. A caller that doesn't
// use every column just ignores the extras.
export async function listActiveDriversForOrg(supabase: AnySupabaseClient, orgId: number) {
  return supabase
    .from('drivers')
    .select('id, driver_number, profile_id, invite_status, default_vehicle_id, cdl_number, cdl_class, cdl_state, cdl_expiry, med_cert_expiry, endorsements, is_active, settlement_type, settlement_rate, profiles(first_name, last_name, phone)')
    .eq('carrier_org_id', orgId)
    .eq('is_active', true)
    .order('driver_number', { ascending: true })
}

export async function countActiveDriversForOrg(supabase: AnySupabaseClient, orgId: number) {
  return supabase
    .from('drivers')
    .select('id', { count: 'exact', head: true })
    .eq('carrier_org_id', orgId)
    .eq('is_active', true)
}

// Bulk cross-org variant — admin org-list/org-detail pages, which want
// "does this org have any drivers at all" regardless of active status (a
// deactivated-but-present driver still counts as onboarding progress for
// the adoption checklist), so this deliberately does NOT filter is_active
// (unlike listActiveDriversForOrg above). Also used for a single org via
// `[orgId]`, since `.in()` with a one-element array is equivalent to `.eq()`.
export async function listDriverIdsForOrgs(supabase: AnySupabaseClient, orgIds: number[]) {
  return supabase
    .from('drivers')
    .select('id, carrier_org_id')
    .in('carrier_org_id', orgIds)
}

export async function createDriver(supabase: AnySupabaseClient, values: Record<string, unknown>) {
  return supabase.from('drivers').insert(values as never).select('id, driver_number, invite_status').single()
}
