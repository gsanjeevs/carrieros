// app/api/admin/billing/route.ts
// ShipmentX admin console — Billing & Payments screen (audit gap #14).
// Scoped to what's real: carrier_details.billing_status/grace_period_until
// (both live columns, actually read/respected elsewhere) and billing_events
// (schema exists, but only real Stripe webhooks populate it — none are
// wired, lib/stripe.ts is a demo stub — so this will show an honest empty
// state, not fabricated data). sx_owner/sx_finance only, matching
// billing_events' RLS (sx_support is excluded there).
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

export async function GET(request: NextRequest) {
  const ctx = await requireAdminRole(request, ['sx_owner', 'sx_finance'])
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const [{ data: atRisk, error: atRiskError }, { data: events, error: eventsError }] = await Promise.all([
    admin
      .from('carrier_details')
      .select('org_id, billing_status, grace_period_until, card_brand, card_last4, organizations(name)')
      .or('billing_status.eq.past_due,grace_period_until.not.is.null'),
    admin
      .from('billing_events')
      .select('id, org_id, event_type, amount, status, card_last4, resolved_at, created_at, organizations(name)')
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (atRiskError || eventsError) {
    logError({ route: 'admin/billing GET', requestId: request.headers.get('x-request-id') }, atRiskError ?? eventsError)
    return apiError('SERVER_ERROR', (atRiskError ?? eventsError)?.message ?? 'Failed to load billing data', 500)
  }

  return NextResponse.json({
    at_risk_orgs: (atRisk ?? []).map((o) => ({
      org_id: o.org_id,
      org_name: (o.organizations as { name: string } | null)?.name ?? null,
      billing_status: o.billing_status,
      grace_period_until: o.grace_period_until,
      card_brand: o.card_brand,
      card_last4: o.card_last4,
    })),
    events: (events ?? []).map((e) => ({
      id: e.id,
      org_id: e.org_id,
      org_name: (e.organizations as { name: string } | null)?.name ?? null,
      event_type: e.event_type,
      amount: e.amount,
      status: e.status,
      card_last4: e.card_last4,
      resolved_at: e.resolved_at,
      created_at: e.created_at,
    })),
  })
}
