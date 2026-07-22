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
// DEMO-MODE SEAM (2026-07-21, same philosophy as lib/stripe.ts's
// createStripeCustomer() and app/api/invoices/[id]/factor/route.ts's
// notifyFactor()): the real settlement calculation — gross revenue
// attribution across the period, applying the driver's actual pay rate,
// deductions, and PDF statement generation — is real business logic this
// round explicitly does not implement. What's built here is the route
// shape (auth, role gate, tier gate, validation, the DB write, the
// error_code contract) so a future pass can replace only the math below
// without touching anything else. The gross/net figures written today are
// a clearly-labeled placeholder: the sum of `loads.rate` for the driver in
// the period, with no deduction or rate-type math applied yet.

import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { hasFeature } from '@/lib/entitlements'

const SETTLEMENT_ROLES = ['owner', 'solo', 'finance']

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization', 400)
  if (!SETTLEMENT_ROLES.includes(profile.role))
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
    .select('id, carrier_org_id, settlement_type')
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

  // PLACEHOLDER MATH: sum of loads.rate for this driver/period as a rough
  // stand-in for real gross-revenue attribution. Real math (applying the
  // driver's actual per-mile/percent/flat rate, deductions, advances) is a
  // future pass — this round only wires the row shape.
  const { data: loads, error: loadsError } = await supabase
    .from('loads')
    .select('id, rate')
    .eq('carrier_org_id', profile.org_id)
    .eq('driver_id', driverId)
    .gte('delivery_date', periodStart)
    .lte('delivery_date', periodEnd)

  if (loadsError) return apiError('SERVER_ERROR', loadsError.message, 500)

  const grossRevenue = (loads ?? []).reduce((sum, l) => sum + Number(l.rate ?? 0), 0)
  // net_pay === gross_revenue placeholder: no deduction/rate-type math
  // applied yet, deliberately — see file-level comment.
  const netPay = grossRevenue

  const { data: settlement, error: insertError } = await supabase
    .from('driver_settlements')
    .insert({
      carrier_org_id: profile.org_id,
      driver_id: driver.id,
      pay_method: driver.settlement_type,
      // rate_value has no source yet — drivers only stores settlement_type
      // today, not a numeric rate. Left null until that field exists.
      rate_value: null,
      gross_revenue: grossRevenue,
      net_pay: netPay,
      loads_count: loads?.length ?? 0,
      payment_status: 'pending',
      period_start: periodStart,
      period_end: periodEnd,
      // Real PDF generation is deferred infrastructure — no statement
      // renderer/storage upload exists in this project yet. Left null
      // rather than faked.
      pdf_statement_path: null,
      created_by: user.id,
    })
    .select('id, payment_status')
    .single()

  if (insertError) return apiError('SERVER_ERROR', insertError.message, 500)

  return NextResponse.json(settlement)
}
