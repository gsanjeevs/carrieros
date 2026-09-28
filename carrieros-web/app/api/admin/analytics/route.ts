import { NextRequest, NextResponse } from 'next/server'
import { apiError, isErrorResponse } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

const TIERS = new Set(['starter', 'growth', 'pro', 'enterprise'])
const FLEET_BANDS = new Set(['no_active_vehicles', '1_vehicle', '2_5_vehicles', '6_20_vehicles', '21_plus_vehicles'])

export async function GET(request: NextRequest) {
  const ctx = await requireAdminRole(request)
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const params = request.nextUrl.searchParams
  const rawPage = Number(params.get('page') ?? 0)
  const rawPageSize = Number(params.get('page_size') ?? 50)
  const search = (params.get('q') ?? '').trim().slice(0, 100) || null
  const tier = params.get('tier') || null
  const fleetBand = params.get('fleet_band') || null
  if (!Number.isSafeInteger(rawPage) || rawPage < 0 || rawPage > 10_000 ||
      !Number.isSafeInteger(rawPageSize) || rawPageSize < 1 || rawPageSize > 100) {
    return apiError('VALIDATION_ERROR', 'Invalid analytics pagination', 400)
  }
  if (tier && !TIERS.has(tier)) return apiError('VALIDATION_ERROR', 'Invalid tier filter', 400)
  if (fleetBand && !FLEET_BANDS.has(fleetBand)) return apiError('VALIDATION_ERROR', 'Invalid fleet-size filter', 400)

  const { data, error } = await admin.rpc('admin_carrier_portfolio_analytics', {
    p_search: search,
    p_tier: tier,
    p_fleet_band: fleetBand,
    p_page: rawPage,
    p_page_size: rawPageSize,
  })
  if (error) {
    logError({ route: 'admin/analytics GET', requestId: request.headers.get('x-request-id') }, error, { step: 'carrier_analytics' })
    return apiError('SERVER_ERROR', 'Could not load carrier analytics', 500)
  }

  const rows = data ?? []
  const summary = rows[0] ? {
    total_carriers: rows[0].total_carriers,
    active_billing_carriers: rows[0].active_billing_carriers,
    trialing_carriers: rows[0].trialing_carriers,
    past_due_carriers: rows[0].past_due_carriers,
  } : { total_carriers: 0, active_billing_carriers: 0, trialing_carriers: 0, past_due_carriers: 0 }

  return NextResponse.json({
    carriers: rows.map(row => ({
      org_id: row.org_id,
      name: row.org_name,
      created_at: row.created_at,
      tier: row.tier,
      billing_status: row.billing_status,
      fleet_band: row.fleet_band,
      active_users: row.active_users,
      active_vehicles: row.active_vehicles,
      active_drivers: row.active_drivers,
      customer_accounts: row.customer_accounts,
      loads_last_30d: row.loads_last_30d,
      loads_previous_30d: row.loads_previous_30d,
      loads_per_active_vehicle: row.loads_per_active_vehicle,
      invoices_last_30d: row.invoices_last_30d,
      open_support_tickets: row.open_support_tickets,
      cohort_carriers: row.cohort_carriers,
      cohort_median_loads_per_vehicle: row.cohort_median_loads_per_vehicle,
    })),
    summary,
    page: rawPage,
    page_size: rawPageSize,
    has_more: rows.length === rawPageSize && (rawPage + 1) * rawPageSize < Number(summary.total_carriers),
  })
}
