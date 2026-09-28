import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'
import { sendEmail } from '@/lib/send-email'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await getAuthedContext(request)
  if (isErrorResponse(context)) return context
  const { supabase, user } = context
  const profile = (await getProfileForUser(supabase, user.id)).data
  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization', 400)
  if (!roleHasCapability(profile.role, 'loads_manage')) return apiError('FORBIDDEN', 'Load management access required', 403)

  const loadId = Number((await params).id)
  if (!Number.isSafeInteger(loadId) || loadId <= 0) return apiError('VALIDATION_ERROR', 'Invalid load id', 400)
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('VALIDATION_ERROR', 'Invalid request body', 400)
  const input = body as Record<string, unknown>
  const exceptionId = Number(input.exception_id)
  const visible = input.visible
  const resend = input.resend === true
  const message = typeof input.customer_message === 'string' ? input.customer_message.trim() : ''
  if (!Number.isSafeInteger(exceptionId) || exceptionId <= 0 || typeof visible !== 'boolean' || (visible && (!message || message.length > 280))) {
    return apiError('VALIDATION_ERROR', 'Provide a customer update of up to 280 characters', 400)
  }

  // Read the prior state before writing so repeated publishes don't send duplicate mail.
  // The explicit resend action below is the only way to send again for an already-public update.
  const [{ data: prior }, { data: load }] = await Promise.all([
    supabase.from('exception_events').select('customer_visible')
      .eq('id', exceptionId).eq('carrier_org_id', profile.org_id)
      .eq('entity_type', 'load').eq('entity_id', loadId).maybeSingle(),
    supabase.from('loads').select('id, load_number, tracking_token, customer_org_id')
      .eq('id', loadId).eq('carrier_org_id', profile.org_id).maybeSingle(),
  ])
  if (!prior || !load?.tracking_token) return apiError('NOT_FOUND', 'Exception or trackable load not found', 404)

  // The database function verifies both tenant ownership and that this event belongs to this exact load.
  const { data, error } = await supabase.rpc('set_tracking_exception_visibility', {
    p_exception_id: exceptionId,
    p_visible: visible,
    p_customer_message: message,
  })
  if (error) {
    if (error.code === 'PT404') return apiError('NOT_FOUND', 'Exception not found', 404)
    if (error.code === 'PT400') return apiError('VALIDATION_ERROR', 'Invalid customer update', 400)
    if (error.code === '42501') return apiError('FORBIDDEN', 'Insufficient permissions', 403)
    return apiError('SERVER_ERROR', 'Could not update customer visibility', 500)
  }

  let notification: { status: 'not_sent' | 'no_recipient' | 'sent' | 'partially_sent' | 'failed'; recipient_count: number; failed_count: number } = {
    status: 'not_sent', recipient_count: 0, failed_count: 0,
  }
  if (visible && (!prior.customer_visible || resend)) {
    const { data: orders, error: ordersError } = await supabase.from('load_orders').select('customer_org_id').eq('load_id', loadId)
    if (ordersError) {
      notification = { status: 'failed', recipient_count: 0, failed_count: 0 }
    } else {
      const customerOrgIds = [...new Set([
        ...(orders ?? []).map((order) => order.customer_org_id),
        ...((orders ?? []).length === 0 && load.customer_org_id ? [load.customer_org_id] : []),
      ])]
      // Notify only explicitly designated primary customer contacts; never fan out to
      // every portal user or include private exception title/detail in the email.
      const { data: contacts, error: contactsError } = customerOrgIds.length
        ? await supabase.from('customer_contacts').select('email').eq('carrier_org_id', profile.org_id)
          .in('org_id', customerOrgIds).eq('is_primary', true).not('email', 'is', null)
        : { data: [], error: null }
      if (contactsError) {
        notification = { status: 'failed', recipient_count: 0, failed_count: 0 }
      } else {
        const recipients = [...new Set((contacts ?? []).map((contact) => contact.email?.trim()).filter((email): email is string => Boolean(email)))]
        if (recipients.length === 0) {
          notification = { status: 'no_recipient', recipient_count: 0, failed_count: 0 }
        } else {
          const trackingUrl = `${request.nextUrl.origin}/track/${encodeURIComponent(load.tracking_token)}`
          const html = `<p>A shipment update is available for load <strong>${escapeHtml(load.load_number)}</strong>.</p><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(trackingUrl)}">Track this shipment</a></p><p>— CarrierOS</p>`
          const results = await Promise.all(recipients.map((to) => sendEmail({
            to, subject: `Shipment update for load ${load.load_number}`, html,
          })))
          const sent = results.filter((result) => result.ok).length
          const failed = results.length - sent
          notification = {
            status: failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partially_sent',
            recipient_count: sent, failed_count: failed,
          }
        }
      }
    }
  }
  return NextResponse.json({
    exception_id: exceptionId, customer_visible: data === true,
    customer_message: visible ? message : null, notification,
  })
}
