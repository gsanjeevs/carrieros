// lib/queries/loads.ts
// Rule B of docs/architecture-principles.md — loads is one of the three
// hottest tables (with profiles/drivers) for ad hoc `.from('loads')` call
// sites. Same posture as lib/queries/profiles.ts: covers the query SHAPES
// actually reused across multiple call sites today, not a full repository
// layer for every possible loads query. A handful of genuinely one-off
// shapes (finance/page.tsx's lane analytics, api/loads/export's wide CSV
// projection) are deliberately left as direct calls — forcing those into a
// shared function here would be a name in search of a caller, not
// encapsulation.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type AnySupabaseClient = SupabaseClient<Database> | ReturnType<typeof import('@supabase/supabase-js').createClient<Database>>

export async function getLoadById(supabase: AnySupabaseClient, loadId: number) {
  return supabase
    .from('loads')
    .select('id, load_number, status, rate, customer_org_id, carrier_org_id, driver_id, vehicle_id')
    .eq('id', loadId)
    .maybeSingle()
}

// Org-scoped variant of getLoadById — callers that need the extra
// carrier_org_id filter as a defense-in-depth check (RLS already enforces
// this, but these routes want a clean NOT_FOUND rather than relying solely
// on RLS). Shared by invoices/actions.ts's createInvoiceForLoad and
// api/loads/[id]/send-documents.
export async function getLoadForOrg(supabase: AnySupabaseClient, loadId: number, orgId: number) {
  return supabase
    .from('loads')
    .select('id, load_number, status, rate, customer_org_id, carrier_org_id, customer_name_raw')
    .eq('id', loadId)
    .eq('carrier_org_id', orgId)
    .maybeSingle()
}

export async function updateLoad(supabase: AnySupabaseClient, loadId: number, values: Record<string, unknown>) {
  return supabase.from('loads').update(values as never).eq('id', loadId)
}

export async function updateLoadStatus(supabase: AnySupabaseClient, loadId: number, status: string) {
  return supabase.from('loads').update({ status }).eq('id', loadId)
}

// Recent-loads widget shape shared by the loads list page and each
// role-branched dashboard view (Owner/Dispatcher) plus the admin org-detail
// page — same "most recent N, with route + customer" projection.
export async function listRecentLoadsForOrg(supabase: AnySupabaseClient, orgId: number, limit = 8) {
  return supabase
    .from('loads')
    .select('id, load_number, status, customer_name_raw, pickup_city, pickup_state, delivery_city, delivery_state, rate, created_at')
    .eq('carrier_org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)
}

export async function countLoadsForOrg(supabase: AnySupabaseClient, orgId: number) {
  return supabase
    .from('loads')
    .select('id', { count: 'exact', head: true })
    .eq('carrier_org_id', orgId)
}

// Same "total + active-loads" widget as countLoadsForOrg, but the caller
// also needs each row's status to bucket into "active" client-side (rather
// than a bare head-count) — shared by OwnerView/DispatcherView dashboards.
export async function listLoadIdsAndStatusForOrg(supabase: AnySupabaseClient, orgId: number) {
  return supabase
    .from('loads')
    .select('id, status', { count: 'exact' })
    .eq('carrier_org_id', orgId)
}

// Bulk cross-org variant — admin pipeline/org-list pages.
export async function countLoadsForOrgs(supabase: AnySupabaseClient, orgIds: number[]) {
  return supabase
    .from('loads')
    .select('id, carrier_org_id')
    .in('carrier_org_id', orgIds)
}

export async function getLoadsRateForOrg(supabase: AnySupabaseClient, orgId: number) {
  return supabase
    .from('loads')
    .select('rate')
    .eq('carrier_org_id', orgId)
    .not('rate', 'is', null)
    .not('status', 'in', '(cancelled,declined)')
}

// "Load history" shape shared by the driver-detail and vehicle-detail
// pages' Loads tab — total_miles/rate for the revenue-stats KPIs, ordered
// by delivery_date (nulls last) rather than created_at, so undelivered
// loads don't push delivered history off the top.
export async function listLoadsForDriver(supabase: AnySupabaseClient, driverId: number) {
  return supabase
    .from('loads')
    .select('id, load_number, status, pickup_city, pickup_state, delivery_city, delivery_state, delivery_date, total_miles, rate')
    .eq('driver_id', driverId)
    .order('delivery_date', { ascending: false, nullsFirst: false })
}

export async function listLoadsForVehicle(supabase: AnySupabaseClient, vehicleId: number) {
  return supabase
    .from('loads')
    .select('id, load_number, status, pickup_city, pickup_state, delivery_city, delivery_state, delivery_date, total_miles, rate')
    .eq('vehicle_id', vehicleId)
    .order('delivery_date', { ascending: false, nullsFirst: false })
}

// Customer-detail page's Loads tab — scoped to both the customer org AND
// the carrier org (a customer_org_id is unique platform-wide, but the
// carrier filter is defense-in-depth, matching the rest of that page's
// queries).
export async function listLoadsForCustomer(supabase: AnySupabaseClient, customerOrgId: number, carrierOrgId: number) {
  return supabase
    .from('loads')
    .select('id, load_number, status, pickup_city, pickup_state, delivery_city, delivery_state, pickup_date, rate, vehicle_id, driver_id')
    .eq('customer_org_id', customerOrgId)
    .eq('carrier_org_id', carrierOrgId)
    .order('created_at', { ascending: false })
}

// "My active load today" widget — a driver's own most-recent active load,
// shared by the DriverView and SoloView dashboards.
const ACTIVE_LOAD_STATUSES = ['dispatched', 'picked_up', 'in_transit']

export async function getActiveLoadForDriver(supabase: AnySupabaseClient, driverId: number) {
  return supabase
    .from('loads')
    .select('load_number, status, pickup_city, pickup_state, delivery_city, delivery_state, customer_name_raw')
    .eq('driver_id', driverId)
    .in('status', ACTIVE_LOAD_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
}

export async function getLoadsByIds(supabase: AnySupabaseClient, loadIds: number[]) {
  return supabase
    .from('loads')
    .select('id, load_number')
    .in('id', loadIds)
}

export async function createLoad(supabase: AnySupabaseClient, values: Record<string, unknown>) {
  return supabase.from('loads').insert(values as never).select('id, load_number').single()
}
