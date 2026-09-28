import { NextRequest, NextResponse } from 'next/server'
import { apiError, isErrorResponse } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { listProfileIdentities } from '@/lib/queries/profiles'
import { logError } from '@/lib/observability'

const PAGE_SIZE = 50
const VALID_STATUSES = ['all', 'open', 'resolved', 'closed'] as const

export async function GET(request: NextRequest) {
  const ctx = await requireAdminRole(request, 'admin_support')
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const params = request.nextUrl.searchParams
  const status = params.get('status') ?? 'open'
  const page = Number(params.get('page') ?? 0)
  const search = (params.get('q') ?? '').trim().slice(0, 120)
  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return apiError('VALIDATION_ERROR', 'Invalid ticket status filter', 400)
  }
  if (!Number.isSafeInteger(page) || page < 0 || page > 10_000) {
    return apiError('VALIDATION_ERROR', 'Invalid page number', 400)
  }

  let ticketQuery = admin
    .from('support_tickets')
    .select('id, carrier_org_id, submitted_by, submitter_role, category, related_load_number, body, status, created_at, updated_at, organizations!support_tickets_carrier_org_id_fkey(name)')
    .eq('queue', 'carrieros_support')
  if (status !== 'all') ticketQuery = ticketQuery.eq('status', status as 'open' | 'resolved' | 'closed')
  if (search) ticketQuery = ticketQuery.ilike('body', `%${search}%`)

  const [{ data: tickets, error: ticketError }, openCount, resolvedCount, closedCount] = await Promise.all([
    ticketQuery
      .order('created_at', { ascending: status === 'open' })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1),
    admin.from('support_tickets').select('id', { count: 'exact', head: true }).eq('queue', 'carrieros_support').eq('status', 'open'),
    admin.from('support_tickets').select('id', { count: 'exact', head: true }).eq('queue', 'carrieros_support').eq('status', 'resolved'),
    admin.from('support_tickets').select('id', { count: 'exact', head: true }).eq('queue', 'carrieros_support').eq('status', 'closed'),
  ])
  const countError = openCount.error ?? resolvedCount.error ?? closedCount.error
  if (ticketError || countError) {
    logError({ route: 'admin/support-tickets GET', requestId: request.headers.get('x-request-id') }, ticketError ?? countError, { step: 'query' })
    return apiError('SERVER_ERROR', 'Could not load support queue', 500)
  }

  const submitterIds = [...new Set((tickets ?? []).map(ticket => ticket.submitted_by))]
  const { data: profiles, error: profileError } = await listProfileIdentities(admin, submitterIds)
  if (profileError) {
    logError({ route: 'admin/support-tickets GET', requestId: request.headers.get('x-request-id') }, profileError, { step: 'submitter_profiles' })
    return apiError('SERVER_ERROR', 'Could not load ticket submitters', 500)
  }
  const profileById = new Map((profiles ?? []).map(profile => [profile.id, profile]))

  const items = (tickets ?? []).map(ticket => {
    const profile = profileById.get(ticket.submitted_by)
    const organization = ticket.organizations as { name: string } | null
    return {
      id: ticket.id,
      carrier_org_id: ticket.carrier_org_id,
      organization_name: organization?.name ?? null,
      submitter_name: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || null,
      submitter_role: ticket.submitter_role,
      category: ticket.category,
      related_load_number: ticket.related_load_number,
      body_preview: ticket.body.length > 240 ? `${ticket.body.slice(0, 240)}…` : ticket.body,
      status: ticket.status,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
    }
  })

  return NextResponse.json({
    tickets: items,
    counts: {
      open: openCount.count ?? 0,
      resolved: resolvedCount.count ?? 0,
      closed: closedCount.count ?? 0,
    },
    page,
    has_more: (tickets?.length ?? 0) === PAGE_SIZE,
  })
}
