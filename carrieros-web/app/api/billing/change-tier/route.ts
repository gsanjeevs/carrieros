// app/api/billing/change-tier/route.ts
//
// POST /api/billing/change-tier — the demo tier upgrade/downgrade flow.
// Owner/solo only, matching /billing's page-level gate and
// add-payment-method's BILLING_ROLES convention.
//
// DEMO MODE (2026-07-21, same seam philosophy as add-payment-method/route.ts
// and lib/stripe.ts's createStripeCustomer() stub): there is no real Stripe
// subscription yet, so this writes carrier_details.tier directly instead of
// calling Stripe's subscription-update API + waiting on a webhook. A real
// integration replaces the body of this route with a Stripe Checkout session
// (or subscription update) that only flips `tier` once the webhook confirms
// payment succeeded — this route is the seam that call will land in.
//
// Validates the target tier against the real `tiers` table rather than a
// hardcoded array, so a future tier addition (a 5th plan) doesn't require
// touching this route.

import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'

const BILLING_ROLES = ['owner', 'solo']

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
  if (!BILLING_ROLES.includes(profile.role))
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  const body = await request.json()
  const { tier } = body

  if (!tier || typeof tier !== 'string')
    return apiError('VALIDATION_ERROR', 'tier is required', 400)

  const { data: tierRow } = await supabase
    .from('tiers')
    .select('code')
    .eq('code', tier)
    .maybeSingle()

  if (!tierRow) return apiError('VALIDATION_ERROR', 'Unknown tier', 400)

  const { data: updated, error: updateError } = await supabase
    .from('carrier_details')
    .update({ tier })
    .eq('org_id', profile.org_id)
    .select('tier')
    .single()

  if (updateError) return apiError('SERVER_ERROR', updateError.message, 500)

  return NextResponse.json(updated)
}
