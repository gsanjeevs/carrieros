// app/api/billing/add-payment-method/route.ts
//
// POST /api/billing/add-payment-method — the demo "Add Payment Method" flow.
// Owner/solo only, matching /billing's page-level gate.
//
// WHY THIS IS AN API ROUTE: same reasoning as
// app/api/invoices/[id]/factor/route.ts — this is the seam where a real
// Stripe integration will need a server-held secret key that must never
// reach the browser or the Expo bundle. The seam itself is
// createStripeCustomer() in lib/stripe.ts; this route validates auth, calls
// it, and persists the result. Swapping in real Stripe is a change to that
// one function body, not this route.
//
// WHAT IT DOES TODAY: validates the caller is owner/solo, calls the
// no-network demo stub, and writes the returned demo customer id + masked
// card onto carrier_details. No real payment method is ever collected here
// — there is no card field in the request body and none should ever be
// added (see lib/stripe.ts's safety-boundary note).

import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { createStripeCustomer } from '@/lib/stripe'
import { SUBSCRIPTION_ROLES } from '@/lib/roles-policy'
import { logError, logEvent } from '@/lib/observability'
import { getProfileForUser } from '@/lib/queries/profiles'

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization', 400)
  if (!SUBSCRIPTION_ROLES.includes(profile.role))
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', profile.org_id)
    .maybeSingle()

  const result = await createStripeCustomer({ id: profile.org_id, name: org?.name ?? null })

  const { data: updated, error: updateError } = await supabase
    .from('carrier_details')
    .update({
      stripe_customer_id: result.stripe_customer_id,
      card_brand: result.card_brand,
      card_last4: result.card_last4,
    })
    .eq('org_id', profile.org_id)
    .select('stripe_customer_id, card_brand, card_last4, billing_status, trial_ends_at')
    .single()

  if (updateError) {
    logError({ route: 'api/billing/add-payment-method', userId: user.id, orgId: profile.org_id }, updateError)
    return apiError('SERVER_ERROR', updateError.message, 500)
  }

  logEvent({ route: 'api/billing/add-payment-method', userId: user.id, orgId: profile.org_id }, {
    card_brand: result.card_brand,
  })
  return NextResponse.json({
    stripe_customer_id: updated.stripe_customer_id,
    card_brand: updated.card_brand,
    card_last4: updated.card_last4,
    billing_status: updated.billing_status,
    trial_ends_at: updated.trial_ends_at,
  })
}
