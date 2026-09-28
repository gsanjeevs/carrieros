import { NextRequest, NextResponse } from 'next/server'
import { apiError, isErrorResponse } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

const STAGES = ['intake', 'setup', 'training', 'launch_ready', 'live', 'blocked'] as const

export async function GET(request: NextRequest) {
  const ctx = await requireAdminRole(request, 'admin_support')
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const { data, error } = await admin.from('admin_carrier_onboarding')
    .select('org_id, contact_name, contact_email, stage, next_action, next_follow_up_at, blocker_note, owner_invite_sent_at, created_at, updated_at, organizations!admin_carrier_onboarding_org_id_fkey(name, carrier_details(tier, billing_status))')
    .order('next_follow_up_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) {
    logError({ route: 'admin/onboarding GET', requestId: request.headers.get('x-request-id') }, error, { step: 'list' })
    return apiError('SERVER_ERROR', 'Could not load carrier onboarding cases', 500)
  }

  const cases = (data ?? []).map(row => {
    const org = row.organizations as { name: string; carrier_details: { tier: string; billing_status: string } | { tier: string; billing_status: string }[] | null } | null
    const details = Array.isArray(org?.carrier_details) ? org.carrier_details[0] : org?.carrier_details
    return {
      org_id: row.org_id,
      company_name: org?.name ?? `Carrier #${row.org_id}`,
      tier: details?.tier ?? 'starter',
      billing_status: details?.billing_status ?? 'trialing',
      contact_name: row.contact_name,
      contact_email: row.contact_email,
      stage: row.stage,
      next_action: row.next_action,
      next_follow_up_at: row.next_follow_up_at,
      blocker_note: row.blocker_note,
      owner_invite_sent_at: row.owner_invite_sent_at,
      updated_at: row.updated_at,
    }
  })
  return NextResponse.json({ cases, stages: STAGES })
}

export async function POST(request: NextRequest) {
  const ctx = await requireAdminRole(request, 'admin_support')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  let body: unknown
  try { body = await request.json() } catch { return apiError('VALIDATION_ERROR', 'Invalid request body', 400) }
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const companyName = typeof input.company_name === 'string' ? input.company_name.trim() : ''
  const contactName = typeof input.contact_name === 'string' ? input.contact_name.trim() : ''
  const contactEmail = typeof input.contact_email === 'string' ? input.contact_email.trim().toLowerCase() : ''
  const tier = typeof input.tier === 'string' ? input.tier : ''
  const country = typeof input.country === 'string' ? input.country : ''
  if (companyName.length < 2 || companyName.length > 160) return apiError('VALIDATION_ERROR', 'Company name must be 2–160 characters', 400)
  if (contactName.length < 1 || contactName.length > 120) return apiError('VALIDATION_ERROR', 'Contact name must be 1–120 characters', 400)
  if (contactEmail.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) return apiError('VALIDATION_ERROR', 'Enter a valid contact email', 400)
  if (!['starter', 'growth', 'pro', 'enterprise'].includes(tier)) return apiError('VALIDATION_ERROR', 'Invalid plan', 400)
  if (!['US', 'CA', 'MX'].includes(country)) return apiError('VALIDATION_ERROR', 'Choose a supported country', 400)

  const { data: orgId, error } = await admin.rpc('admin_create_carrier_onboarding', {
    p_company_name: companyName,
    p_contact_name: contactName,
    p_contact_email: contactEmail,
    p_tier: tier,
    p_country: country,
    p_created_by: userId,
  })
  if (error || !orgId) {
    logError({ route: 'admin/onboarding POST', requestId: request.headers.get('x-request-id') }, error, { step: 'create_case' })
    return apiError('SERVER_ERROR', 'Could not start carrier onboarding', 500)
  }
  return NextResponse.json({ org_id: orgId }, { status: 201 })
}
