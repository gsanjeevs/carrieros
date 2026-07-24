// app/api/loads/[id]/route.ts
// PATCH — update driver, vehicle, and/or status on a load
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { hasFeature } from '@/lib/entitlements'
import { getProfileForUser } from '@/lib/queries/profiles'
import { getLoadById } from '@/lib/queries/loads'
import { sendPushNotification } from '@/lib/send-push'

const VALID_STATUSES = ['draft','scheduled','dispatched','picked_up','in_transit','delivered','invoiced','paid','cancelled','declined']

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id)
    return apiError('NOT_ONBOARDED', 'No organization', 400)

  if (!['owner', 'solo', 'dispatcher'].includes(profile.role))
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  const body = await request.json()
  const update: { driver_id?: number | null; vehicle_id?: number | null; status?: string } = {}

  // driver_id/vehicle_id are BIGINT FKs — null clears the assignment, anything
  // that isn't a number is a client error rather than something to pass through.
  for (const field of ['driver_id', 'vehicle_id'] as const) {
    if (!(field in body)) continue
    const v = body[field]
    if (v === null || v === undefined || v === '') { update[field] = null; continue }
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
    if (!Number.isInteger(n)) return apiError('VALIDATION_ERROR', `Invalid ${field}`, 400)
    update[field] = n
  }

  if ('status' in body) {
    if (typeof body.status !== 'string' || !VALID_STATUSES.includes(body.status))
      return apiError('VALIDATION_ERROR', 'Invalid status', 400)
    update.status = body.status
  }

  if (Object.keys(update).length === 0)
    return apiError('VALIDATION_ERROR', 'Nothing to update', 400)

  const { error } = await supabase
    .from('loads')
    .update(update)
    .eq('id', Number(id))
    .eq('carrier_org_id', profile.org_id)

  if (error) return apiError('SERVER_ERROR', error.message, 500)

  // Push notification on dispatch (PRD P0: "driver receives push
  // notification on assignment"). Fire-and-forget — a failed/missing push
  // token must never fail the dispatch action itself, same principle as
  // markInvoiceSent()'s NO_RECIPIENT_EMAIL warning-not-error handling.
  if (update.status === 'dispatched') {
    const { data: loadRow } = await getLoadById(supabase, Number(id))

    if (loadRow?.driver_id) {
      const { data: driver } = await supabase
        .from('drivers')
        .select('profiles(push_token)')
        .eq('id', loadRow.driver_id)
        .maybeSingle()
      const pushToken = driver?.profiles?.push_token
      if (pushToken) {
        sendPushNotification({
          to: pushToken,
          title: 'New load assigned',
          body: `You've been dispatched on load ${loadRow.load_number}.`,
          data: { loadId: Number(id) },
        }).catch(() => {})
      }
    }
  }

  // Log status change event
  if (update.status) {
    await supabase.from('load_events').insert({
      load_id:    Number(id),
      event_type: `status_${update.status}`,
      created_by: user.id,
    })
  }

  // IFTA completeness check (Phase 7C, check_ifta_completeness DB function,
  // ifta_mileage_log feature / BR-22's 60% GPS-completeness threshold).
  // Starter orgs don't have the feature at all, so they skip the check
  // entirely rather than being told about a threshold they can't act on.
  //
  // This is data-scaffolding only: a `false` result does NOT block or alter
  // the delivered transition above — deciding whether/how to enforce
  // completeness before allowing delivery is a business-logic call this
  // round doesn't own. The boolean is surfaced on the response purely as an
  // informational field so a future consumer (UI banner, blocking flow,
  // notification) has something to act on.
  let iftaMileageComplete: boolean | null = null
  if (update.status === 'delivered') {
    const iftaEntitled = await hasFeature(supabase, 'ifta_mileage_log')
    if (iftaEntitled) {
      const { data: completeness, error: iftaError } = await supabase.rpc(
        'check_ifta_completeness',
        { p_load_id: Number(id) }
      )
      if (iftaError) {
        console.error('[api/loads/[id] PATCH] check_ifta_completeness failed', iftaError)
      } else {
        iftaMileageComplete = completeness ?? null
      }
    }
  }

  return NextResponse.json({
    ok: true,
    ...(iftaMileageComplete !== null ? { ifta_mileage_complete: iftaMileageComplete } : {}),
  })
}
