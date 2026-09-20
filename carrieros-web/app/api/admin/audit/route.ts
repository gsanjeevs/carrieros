// app/api/admin/audit/route.ts
// ShipmentX admin console — Audit & Activity screen (audit gap #14).
// admin_events already existed (populated by the note/impersonate/tier/
// trial/grace-period/flag-override routes) but had no read route. Scoped
// honestly: this table only ever logs admin-INITIATED actions, not a full
// cross-tenant audit trail (no login/load/billing event logging exists —
// see this route's own header note in the schema comment). Any sx_* role
// may read it (matches admin_events' RLS SELECT policy exactly).
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

const PAGE_SIZE = 100

export async function GET(request: NextRequest) {
  const ctx = await requireAdminRole(request)
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const { data, error } = await admin
    .from('admin_events')
    .select('id, event_type, metadata, created_at, organizations(name), profiles(first_name, last_name)')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE)

  if (error) {
    logError({ route: 'admin/audit GET', requestId: request.headers.get('x-request-id') }, error)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  const events = (data ?? []).map((e) => ({
    id: e.id,
    event_type: e.event_type,
    metadata: e.metadata,
    created_at: e.created_at,
    org_name: (e.organizations as { name: string } | null)?.name ?? null,
    admin_name: e.profiles
      ? [(e.profiles as { first_name: string | null }).first_name, (e.profiles as { last_name: string | null }).last_name]
          .filter(Boolean)
          .join(' ') || null
      : null,
  }))

  return NextResponse.json({ events })
}
