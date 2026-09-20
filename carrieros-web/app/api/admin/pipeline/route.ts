// app/api/admin/pipeline/route.ts
// ShipmentX admin console — Sales Pipeline screen (audit gap #14). No
// `sales_pipeline` table exists (confirmed absent from schema.sql) — this
// computes the same two lists mockup-23 describes directly from real,
// already-existing columns instead: trials sorted by days remaining, and
// "upgrade candidate" Starter orgs (>=8 loads in the last 30 days, or more
// than one active driver). sx_owner/sx_finance only, same as billing.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { countActiveDriversForOrg } from '@/lib/queries/drivers'
import { logError } from '@/lib/observability'

const UPGRADE_LOAD_THRESHOLD = 8

export async function GET(request: NextRequest) {
  const ctx = await requireAdminRole(request, 'admin_billing')
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const { data: trialing, error: trialingError } = await admin
    .from('carrier_details')
    .select('org_id, trial_ends_at, organizations(name)')
    .eq('billing_status', 'trialing')
    .order('trial_ends_at', { ascending: true })

  const { data: starterOrgs, error: starterError } = await admin
    .from('carrier_details')
    .select('org_id, organizations(name)')
    .eq('tier', 'starter')

  if (trialingError || starterError) {
    logError({ route: 'admin/pipeline GET', requestId: request.headers.get('x-request-id') }, trialingError ?? starterError)
    return apiError('SERVER_ERROR', (trialingError ?? starterError)?.message ?? 'Failed to load pipeline data', 500)
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const candidates = await Promise.all(
    (starterOrgs ?? []).map(async (o) => {
      const [{ count: loadsLast30d }, { count: driverCount }] = await Promise.all([
        admin.from('loads').select('id', { count: 'exact', head: true }).eq('carrier_org_id', o.org_id).gte('created_at', thirtyDaysAgo),
        countActiveDriversForOrg(admin, o.org_id),
      ])
      return {
        org_id: o.org_id,
        org_name: (o.organizations as { name: string } | null)?.name ?? null,
        loads_last_30d: loadsLast30d ?? 0,
        active_drivers: driverCount ?? 0,
      }
    })
  )

  const upgradeCandidates = candidates.filter((c) => c.loads_last_30d >= UPGRADE_LOAD_THRESHOLD || c.active_drivers > 1)

  return NextResponse.json({
    trialing: (trialing ?? []).map((t) => ({
      org_id: t.org_id,
      org_name: (t.organizations as { name: string } | null)?.name ?? null,
      trial_ends_at: t.trial_ends_at,
    })),
    upgrade_candidates: upgradeCandidates,
  })
}
