// app/api/admin/orgs/[org_id]/route.ts
// ShipmentX admin console — single-org detail aggregate (Phase 8
// foundation, 2026-07-22). Mirrors mockup-23's Org Detail screen: KPIs,
// an adoption-milestone checklist, recent activity, and admin notes.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { createAuthAdminProvider } from '@/lib/auth-admin'
import { listProfilesForOrg } from '@/lib/queries/profiles'
import { listRecentLoadsForOrg } from '@/lib/queries/loads'
import { listDriverIdsForOrgs } from '@/lib/queries/drivers'
import { logError } from '@/lib/observability'

export async function GET(request: NextRequest, { params }: { params: Promise<{ org_id: string }> }) {
  const ctx = await requireAdminRole(request)
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const orgId = Number((await params).org_id)
  if (!Number.isInteger(orgId)) return apiError('VALIDATION_ERROR', 'org_id must be an integer', 400)

  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .select('id, name, created_at, carrier_details(*)')
    .eq('id', orgId)
    .eq('type', 'carrier')
    .maybeSingle()

  if (orgErr) {
    logError({ route: 'admin/orgs/:id', requestId: request.headers.get('x-request-id') }, orgErr, { step: 'org' })
    return apiError('SERVER_ERROR', orgErr.message, 500)
  }
  if (!org) return apiError('NOT_FOUND', 'Carrier org not found', 404)

  const [{ data: profiles }, { data: loads }, { data: invoices }, { data: drivers }, { data: vehicles }, { data: notes }] =
    await Promise.all([
      listProfilesForOrg(admin, orgId),
      listRecentLoadsForOrg(admin, orgId, 50),
      admin.from('invoices').select('id, status, load_id').eq('carrier_org_id', orgId),
      listDriverIdsForOrgs(admin, [orgId]),
      admin.from('vehicles').select('id').eq('carrier_org_id', orgId),
      admin
        .from('admin_notes')
        .select('id, body, admin_id, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false }),
    ])

  // loads has no invoice_id column -- invoices FK the other way (load_id) --
  // so "uninvoiced" is delivered loads whose id never appears as an
  // invoice's load_id, per mockup-23's spec (`status='delivered' AND
  // invoice_id IS NULL`), adapted to this schema's actual FK direction.
  const invoicedLoadIds = new Set((invoices ?? []).map(i => i.load_id).filter((id): id is number => id != null))
  const uninvoicedRevenue = (loads ?? [])
    .filter(l => l.status === 'delivered' && !invoicedLoadIds.has(l.id))
    .reduce((sum, l) => sum + (l.rate ?? 0), 0)

  const { data: userList } = await createAuthAdminProvider(admin).listUsers()
  const emailByUserId = new Map(userList?.users.map(u => [u.id, u.email]) ?? [])
  const lastSignInByUserId = new Map(userList?.users.map(u => [u.id, u.lastSignInAt]) ?? [])

  const users = (profiles ?? []).map(p => ({
    id: p.id,
    name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
    role: p.role,
    email: emailByUserId.get(p.id) ?? null,
    last_sign_in_at: lastSignInByUserId.get(p.id) ?? null,
  }))

  const lastActive = users.reduce<string | null>((latest, u) => {
    if (!u.last_sign_in_at) return latest
    if (!latest || new Date(u.last_sign_in_at) > new Date(latest)) return u.last_sign_in_at
    return latest
  }, null)

  // Adoption milestones -- mirrors mockup-23's 7-item checklist.
  const adoption = {
    completed_onboarding: !!org.carrier_details,
    added_first_vehicle: (vehicles?.length ?? 0) > 0,
    added_first_driver: (drivers?.length ?? 0) > 0,
    created_first_load: (loads?.length ?? 0) > 0,
    dispatched_load: (loads ?? []).some(l => ['dispatched', 'picked_up', 'in_transit', 'delivered', 'invoiced', 'paid'].includes(l.status ?? '')),
    sent_first_invoice: (invoices?.length ?? 0) > 0,
    received_first_payment: (invoices ?? []).some(i => i.status === 'paid'),
  }

  const details = Array.isArray(org.carrier_details) ? org.carrier_details[0] : org.carrier_details

  return NextResponse.json({
    org: { id: org.id, name: org.name, created_at: org.created_at },
    carrier_details: details ?? null,
    kpis: {
      loads_this_month: (loads ?? []).filter(
        l => !!l.created_at && new Date(l.created_at).getTime() >= Date.now() - 30 * 86_400_000
      ).length,
      uninvoiced_revenue: uninvoicedRevenue,
      last_active: lastActive,
    },
    adoption,
    users,
    recent_loads: (loads ?? []).slice(0, 10),
    notes: notes ?? [],
  })
}
