// app/api/driver-messages/route.ts
// POST — send a driver <-> back-office message on a load's thread (Phase 7D,
// driver_chat feature, Growth+ per decisions.md / BRD §9). RLS on
// driver_messages already scopes reads/writes to the assigned driver or an
// owner/solo/dispatcher of the load's org — Finance gets none of it, by
// design (BR-2/FR-119). This route does its own explicit access check on
// top of RLS anyway, matching the convention in app/api/team/[id]/route.ts:
// RLS is the backstop, not the only place the check lives, so a rejected
// request gets a clean error_code instead of an opaque RLS-denied insert.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { hasFeature } from '@/lib/entitlements'
import { getProfileForUser } from '@/lib/queries/profiles'
import { getLoadById } from '@/lib/queries/loads'
import { getDriverIdForProfile } from '@/lib/queries/drivers'
import { logError, logEvent } from '@/lib/observability'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

/**
 * TODO(push): no Expo Push API credential exists in this project yet (no
 * push token registry, no server key configured) — this is a stub seam,
 * mirroring lib/stripe.ts's createStripeCustomer(). It does not contact
 * Expo's push service or anyone's device. The caller fires this and moves
 * on without awaiting/blocking on the result — a notification failing must
 * never fail the message send itself, since the message row is already
 * durably written by the time this runs.
 */
function sendPushNotification(params: { loadId: number; senderId: string; body: string }): void {
  logEvent({ route: 'driver-messages:push-stub' }, { message: 'would push-notify the other party on this thread', params })
}

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) {
    return apiError('NOT_ONBOARDED', 'No organization found for this user', 400)
  }

  const entitled = await hasFeature(supabase, 'driver_chat')
  if (!entitled) {
    return apiError(
      'TIER_UPGRADE_REQUIRED',
      'Driver messaging requires the Growth plan or above',
      403
    )
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400)
  }

  const rawLoadId = body.load_id
  const messageBody = body.body

  if (typeof rawLoadId !== 'number' && typeof rawLoadId !== 'string') {
    return apiError('VALIDATION_ERROR', 'load_id is required', 400)
  }
  const loadId = Number(rawLoadId)
  if (!Number.isFinite(loadId)) {
    return apiError('VALIDATION_ERROR', 'load_id is required', 400)
  }
  if (typeof messageBody !== 'string' || messageBody.trim() === '') {
    return apiError('VALIDATION_ERROR', 'body is required', 400)
  }

  const { data: load } = await getLoadById(supabase, loadId)

  if (!load) {
    return apiError('NOT_FOUND', 'No such load', 404)
  }

  // Access check: either the caller is the assigned driver on this load, or
  // they're owner/solo/dispatcher for the load's org. RLS enforces the same
  // thing at insert time, but per this codebase's convention (team/[id]) the
  // route checks explicitly first so a rejection is a clean FORBIDDEN, not a
  // bare RLS-denied insert failure.
  // Office staff, i.e. may act on ANY load in the org — deliberately NOT 'chat_participate', which also
  // covers the driver, whose access is the separate assigned-load check below.
  let allowed = load.carrier_org_id === profile.org_id && roleHasCapability(profile.role, 'loads_manage')

  if (!allowed) {
    const { data: driverRow } = await getDriverIdForProfile(supabase, user.id)
    allowed = !!driverRow && driverRow.id === load.driver_id
  }

  if (!allowed) {
    return apiError('FORBIDDEN', 'You do not have access to this load’s messages', 403)
  }

  // original_language inheritance chain: sender's own preferred_language
  // first, falling back to their carrier's default_language, then 'en' —
  // same shape as the locale-resolution precedent in i18n/request.ts
  // (cookie value, else 'en'), extended here with the carrier-level rung
  // since a message's origin language needs to survive even for a sender
  // who has never set a personal preference.
  let originalLanguage = profile.preferred_language
  if (!originalLanguage) {
    const { data: carrierDetails } = await supabase
      .from('carrier_details')
      .select('default_language')
      .eq('org_id', profile.org_id)
      .maybeSingle()
    originalLanguage = carrierDetails?.default_language ?? 'en'
  }

  const { data: inserted, error } = await supabase
    .from('driver_messages')
    .insert({
      carrier_org_id: load.carrier_org_id,
      load_id: load.id,
      sender_id: user.id,
      body: messageBody,
      original_language: originalLanguage,
    })
    .select('id, sent_at')
    .single()

  if (error || !inserted) {
    logError({ route: 'api/driver-messages POST', requestId: request.headers.get('x-request-id') }, error)
    return apiError('SERVER_ERROR', error?.message ?? 'Failed to send message', 500)
  }

  // Fire-and-forget — see the stub's own comment for why this never blocks
  // or fails the request.
  sendPushNotification({ loadId: load.id, senderId: user.id, body: messageBody })

  return NextResponse.json({ id: inserted.id, sent_at: inserted.sent_at }, { status: 201 })
}
