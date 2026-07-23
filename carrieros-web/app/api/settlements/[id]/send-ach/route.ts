// app/api/settlements/[id]/send-ach/route.ts
//
// POST /api/settlements/:id/send-ach — mark a settlement as sent for
// payment via ACH. Owner/solo/finance only, same role set as
// app/api/settlements/run/route.ts and driver_settlements' RLS policy.
//
// Gated Pro+ via the `settlement_ach` feature (has_feature RPC) — a
// stricter tier than the Growth+ gate on settlement creation itself.
//
// DEMO-MODE SEAM (2026-07-21, same philosophy as lib/stripe.ts's
// createStripeCustomer()): a real ACH transfer needs a Stripe Connect
// account (or equivalent bank-transfer API) that does not exist in this
// project yet — lib/stripe.ts only has the demo payment-method stub, no
// Connect account, no payout capability. This route does not move any
// money. It simulates the "sent" step by flipping payment_status, exactly
// the way createStripeCustomer() simulates a card add — so the UI and data
// model are ready for a real integration to drop in behind this function
// without changing anything else in the route.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { hasFeature } from '@/lib/entitlements'
import { getProfileForUser } from '@/lib/queries/profiles'

const SETTLEMENT_ROLES = ['owner', 'solo', 'finance']

/**
 * TODO(stripe-connect / ACH partner): replace this body with a real
 * transfer once a Stripe Connect account (or bank-transfer API) exists for
 * this org. Real implementation would: initiate the ACH transfer against
 * the driver's payout destination, and only flip payment_status to 'sent'
 * (or 'cleared') once the provider confirms — mirroring the seam
 * documented in lib/stripe.ts's createStripeCustomer().
 */
function sendAchTransfer(params: { settlementId: number; netPay: number; driverId: number | null }): void {
  console.log(
    '[settlements:ach-stub] no ACH/Connect account is configured — no money was moved.',
    JSON.stringify(params)
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const settlementId = Number(id)
  if (!Number.isInteger(settlementId)) {
    return apiError('VALIDATION_ERROR', 'Invalid settlement id', 400)
  }

  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization', 400)
  if (!SETTLEMENT_ROLES.includes(profile.role))
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  const entitled = await hasFeature(supabase, 'settlement_ach')
  if (!entitled) {
    return apiError(
      'TIER_UPGRADE_REQUIRED',
      'ACH settlement payments require the Pro plan or above',
      403
    )
  }

  const { data: settlement, error: readError } = await supabase
    .from('driver_settlements')
    .select('id, carrier_org_id, driver_id, net_pay, payment_status')
    .eq('id', settlementId)
    .eq('carrier_org_id', profile.org_id)
    .maybeSingle()

  if (readError) return apiError('SERVER_ERROR', readError.message, 500)
  if (!settlement) return apiError('NOT_FOUND', 'Settlement not found', 404)

  const { data: updated, error: updateError } = await supabase
    .from('driver_settlements')
    .update({ payment_status: 'sent' })
    .eq('id', settlementId)
    .eq('carrier_org_id', profile.org_id)
    .select('id, payment_status')
    .single()

  if (updateError) return apiError('SERVER_ERROR', updateError.message, 500)

  // Fire-and-forget demo side effect — see the stub's own comment. Never
  // moves real money.
  sendAchTransfer({
    settlementId: settlement.id,
    netPay: Number(settlement.net_pay),
    driverId: settlement.driver_id,
  })

  return NextResponse.json({ id: updated.id, payment_status: updated.payment_status })
}
