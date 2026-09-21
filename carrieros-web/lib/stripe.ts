// lib/stripe.ts
//
// Billing seam — the one function a real Stripe integration replaces.
// Mirrors the pattern in app/api/invoices/[id]/factor/route.ts: validate,
// write state, call a single stub function. There is no Stripe account yet
// (no keys), so createStripeCustomer() below does not call the Stripe SDK at
// all — it simulates success and writes demo values.
//
// SAFETY BOUNDARY: this file, and everything that calls it, must never
// accept or handle a real card number, CVV, or expiry. "Adding a card" in
// this app is a single button click that simulates success using Stripe's
// own published, non-functional test card (4242 4242 4242 4242) — see
// app/(app)/billing/AddPaymentMethodButton.tsx. No input field for a card
// number exists anywhere in this feature, demo or not.

import { logEvent } from '@/lib/observability'

export interface StripeCustomerResult {
  stripe_customer_id: string
  card_brand: string
  card_last4: string
}

/**
 * TODO(stripe): replace this body with the real integration once a Stripe
 * account exists.
 *
 * Real implementation would: create an actual Stripe Customer for `org`,
 * start a Checkout Session in `setup` mode (collecting the card on Stripe's
 * hosted page — never in our own form, per decision P4's card-at-onboarding
 * amendment), and on webhook completion store the REAL customer id and the
 * card brand/last4 Stripe returns. That webhook handling doesn't exist yet
 * either (there is nothing to wire to without an account) — this function is
 * the entire seam for both the customer creation and the eventual webhook
 * write.
 *
 * WHAT IT DOES TODAY: generates a fake demo customer id and a hardcoded
 * "visa / 4242" card — Stripe's own published test constant, not a real
 * financial credential — and returns it for the caller to persist. Nothing
 * leaves this process; no network call is made.
 */
export async function createStripeCustomer(org: {
  id: number
  name?: string | null
}): Promise<StripeCustomerResult> {
  logEvent({ route: 'billing:stub' }, { message: 'no Stripe account configured — simulating a demo payment method', orgId: org.id, orgName: org.name ?? null })

  return {
    stripe_customer_id: `demo_cus_${org.id}_${Date.now()}`,
    card_brand: 'visa',
    card_last4: '4242',
  }
}
