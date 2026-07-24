// app/api/admin/orgs/route.ts
// ShipmentX admin console — cross-tenant carrier org list with a health
// score (Phase 8 foundation, 2026-07-22). Mirrors mockup-23's Customer
// Health Board / Triage Queue KPI row. See lib/admin-auth.ts for the
// authorization model this and every other /api/admin/** route follows.
//
// Health score formula is a simplified proxy for mockup-23's own spec
// (`(login_recency*30 + load_velocity*35 + feature_depth*35) / 100`) —
// computed here from data that's actually available today (auth.users'
// last_sign_in_at via the admin client, loads created in the last 30 days,
// and a milestone-style feature-depth count). Refine with real usage
// analytics later; this proves the end-to-end pattern, not the final
// scoring model.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { createAuthAdminProvider } from '@/lib/auth-admin'
import { listProfilesForOrgs } from '@/lib/queries/profiles'
import { listDriverIdsForOrgs } from '@/lib/queries/drivers'

function loginRecencyScore(lastSignInAt: string | null | undefined): number {
  if (!lastSignInAt) return 0
  const days = (Date.now() - new Date(lastSignInAt).getTime()) / 86_400_000
  if (days < 1) return 100
  if (days < 7) return 70
  if (days < 30) return 40
  return 10
}

function loadVelocityScore(loadsLast30Days: number): number {
  return Math.min(loadsLast30Days * 10, 100)
}

function featureDepthScore(signals: {
  hasDrivers: boolean
  hasCustomers: boolean
  hasInvoices: boolean
  hasVehicles: boolean
}): number {
  const present = Object.values(signals).filter(Boolean).length
  return Math.round((present / 4) * 100)
}

export async function GET(request: NextRequest) {
  const ctx = await requireAdminRole(request)
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const { data: orgs, error: orgsErr } = await admin
    .from('organizations')
    .select('id, name, created_at, carrier_details(tier, billing_status, trial_ends_at, grace_period_until)')
    .eq('type', 'carrier')

  if (orgsErr) {
    console.error('[admin/orgs] orgs:', orgsErr)
    return apiError('SERVER_ERROR', orgsErr.message, 500)
  }

  const orgIds = (orgs ?? []).map(o => o.id)
  if (orgIds.length === 0) return NextResponse.json({ orgs: [] })

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const [{ data: profiles }, { data: recentLoads }, { data: drivers }, { data: invoices }, { data: vehicles }] =
    await Promise.all([
      listProfilesForOrgs(admin, orgIds),
      admin.from('loads').select('id, carrier_org_id').in('carrier_org_id', orgIds).gte('created_at', thirtyDaysAgo),
      listDriverIdsForOrgs(admin, orgIds),
      admin.from('invoices').select('id, carrier_org_id').in('carrier_org_id', orgIds),
      admin.from('vehicles').select('id, carrier_org_id').in('carrier_org_id', orgIds),
    ])

  // last_sign_in_at isn't in a public table — pull it from the Admin Auth
  // API once and join in memory (dev-scale org counts; fine for now).
  const { data: userList } = await createAuthAdminProvider(admin).listUsers()
  const lastSignInByUserId = new Map(userList?.users.map(u => [u.id, u.lastSignInAt]) ?? [])

  const orgIdToLastSignIn = new Map<number, string | null>()
  for (const p of profiles ?? []) {
    const signedIn = lastSignInByUserId.get(p.id)
    const current = orgIdToLastSignIn.get(p.org_id)
    if (signedIn && (!current || new Date(signedIn) > new Date(current))) {
      orgIdToLastSignIn.set(p.org_id, signedIn)
    }
  }

  const countByOrg = (rows: { carrier_org_id: number }[] | null) => {
    const m = new Map<number, number>()
    for (const r of rows ?? []) m.set(r.carrier_org_id, (m.get(r.carrier_org_id) ?? 0) + 1)
    return m
  }
  const loadsThisMonth = countByOrg(recentLoads)
  const driverCount = countByOrg(drivers)
  const invoiceCount = countByOrg(invoices)
  const vehicleCount = countByOrg(vehicles)

  const result = (orgs ?? []).map(org => {
    const details = Array.isArray(org.carrier_details) ? org.carrier_details[0] : org.carrier_details
    const lastActive = orgIdToLastSignIn.get(org.id) ?? null
    const loginScore = loginRecencyScore(lastActive)
    const velocityScore = loadVelocityScore(loadsThisMonth.get(org.id) ?? 0)
    const depthScore = featureDepthScore({
      hasDrivers: (driverCount.get(org.id) ?? 0) > 0,
      // customer orgs aren't carrier-scoped (they're their own organizations
      // rows); attributing "has added a customer" per-carrier needs a
      // distinct loads.customer_org_id count, deferred for now -- treated
      // as satisfied so a missing signal doesn't unfairly tank the score.
      hasCustomers: true,
      hasInvoices: (invoiceCount.get(org.id) ?? 0) > 0,
      hasVehicles: (vehicleCount.get(org.id) ?? 0) > 0,
    })
    const healthScore = Math.round(loginScore * 0.3 + velocityScore * 0.35 + depthScore * 0.35)

    return {
      org_id: org.id,
      name: org.name,
      tier: details?.tier ?? null,
      billing_status: details?.billing_status ?? null,
      trial_ends_at: details?.trial_ends_at ?? null,
      grace_period_until: details?.grace_period_until ?? null,
      last_active: lastActive,
      loads_this_month: loadsThisMonth.get(org.id) ?? 0,
      health_score: healthScore,
    }
  })

  result.sort((a, b) => a.health_score - b.health_score)

  return NextResponse.json({ orgs: result })
}
