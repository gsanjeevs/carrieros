// app/api/settlements/run/route.ts
//
// POST /api/settlements/run — create a driver settlement for a pay period
// (Phase 7E, driver_settlements table). Owner/solo/finance only — same
// role set as driver_settlements' "owner_solo_finance_settlements_all" RLS
// policy (drivers see only their own via a separate SELECT-only policy,
// dispatchers get no access at all).
//
// Gated Growth+ via the `driver_settlements` feature (has_feature RPC).
//
// Real pay-rate math (2026-07-22): gross_revenue is always the sum of
// loads.rate for the driver/period (what the carrier billed for that
// work); net_pay applies the driver's settlement_type/settlement_rate —
// percent_of_rate: gross * (rate/100); per_mile: sum(total_miles) * rate;
// flat_per_load: loads_count * rate. rate_value is snapshotted onto the
// settlement row so a later change to the driver's default rate never
// rewrites past settlement history. Deductions (advances, garnishments)
// remain unimplemented per the BRD's own OQ-11c ("unresolved for MVP") —
// settlement_deductions exists as a table for a future pass, not wired
// here. PDF statement generation is also still deferred (no
// pdf_statement_path is written) — the print/PDF pattern used for
// invoices (app/(app)/invoices/[invoice_number]/print/) is the intended
// model for that follow-up.

import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { hasFeature } from '@/lib/entitlements'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization', 400)
  if (!roleHasCapability(profile.role, 'settlements_manage'))
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  const entitled = await hasFeature(supabase, 'driver_settlements')
  if (!entitled) {
    return apiError(
      'TIER_UPGRADE_REQUIRED',
      'Driver settlements require the Growth plan or above',
      403
    )
  }

  let body: { driver_id?: unknown; period_start?: unknown; period_end?: unknown }
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid JSON body', 400)
  }

  const driverId =
    typeof body.driver_id === 'number'
      ? body.driver_id
      : typeof body.driver_id === 'string'
        ? Number(body.driver_id)
        : NaN
  const periodStart = typeof body.period_start === 'string' ? body.period_start : ''
  const periodEnd = typeof body.period_end === 'string' ? body.period_end : ''

  if (!Number.isInteger(driverId)) {
    return apiError('VALIDATION_ERROR', 'driver_id is required', 400)
  }
  if (!periodStart || !periodEnd) {
    return apiError('VALIDATION_ERROR', 'period_start and period_end are required', 400)
  }

  // Confirm the driver belongs to the caller's org, and pick up their
  // configured settlement_type while we're at it.
  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id, carrier_org_id, settlement_type, settlement_rate')
    .eq('id', driverId)
    .eq('carrier_org_id', profile.org_id)
    .maybeSingle()

  if (driverError) return apiError('SERVER_ERROR', driverError.message, 500)
  if (!driver) return apiError('NOT_FOUND', 'Driver not found', 404)

  if (!driver.settlement_type) {
    return apiError(
      'VALIDATION_ERROR',
      'Driver has no settlement_type configured',
      400
    )
  }
  if (driver.settlement_rate == null) {
    return apiError(
      'VALIDATION_ERROR',
      'Driver has no settlement_rate configured',
      400
    )
  }

  const { data: loads, error: loadsError } = await supabase
    .from('loads')
    .select('id, rate, total_miles')
    .eq('carrier_org_id', profile.org_id)
    .eq('driver_id', driverId)
    .gte('delivery_date', periodStart)
    .lte('delivery_date', periodEnd)

  if (loadsError) return apiError('SERVER_ERROR', loadsError.message, 500)

  const loadsCount = loads?.length ?? 0
  const grossRevenue = (loads ?? []).reduce((sum, l) => sum + Number(l.rate ?? 0), 0)
  const rateValue = Number(driver.settlement_rate)

  let netPay: number
  if (driver.settlement_type === 'percent_of_rate') {
    netPay = grossRevenue * (rateValue / 100)
  } else if (driver.settlement_type === 'per_mile') {
    const totalMiles = (loads ?? []).reduce((sum, l) => sum + Number(l.total_miles ?? 0), 0)
    netPay = totalMiles * rateValue
  } else {
    // flat_per_load
    netPay = loadsCount * rateValue
  }

  // Atomic insert + outbox event (T19 readiness layer, migration 0033),
  // replacing the old plain INSERT. Idempotency key is deterministic per
  // driver+period: re-running settlements/run for the same driver and pay
  // period is the retried-command case this key exists to make safe.
  const { data: cmdData, error: cmdError } = await supabase.rpc('create_driver_settlement_command', {
    p_driver_id: driver.id,
    p_pay_method: driver.settlement_type,
    p_rate_value: rateValue,
    p_gross_revenue: grossRevenue,
    p_net_pay: netPay,
    p_loads_count: loadsCount,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_correlation_id: crypto.randomUUID(),
    p_idempotency_key: `settlement:create:${driver.id}:${periodStart}:${periodEnd}`,
  })

  if (cmdError) {
    if (cmdError.message?.includes('TIER_UPGRADE_REQUIRED')) {
      return apiError('TIER_UPGRADE_REQUIRED', 'Driver settlements require the Growth plan or above', 403)
    }
    return apiError('SERVER_ERROR', cmdError.message, 500)
  }
  const settlement = cmdData as unknown as { id: number; payment_status: string }

  return NextResponse.json({ id: settlement.id, payment_status: settlement.payment_status })
}
