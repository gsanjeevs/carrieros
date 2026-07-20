// app/api/loads/[id]/route.ts
// PATCH — update driver, truck, and/or status on a load
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'

const VALID_STATUSES = ['draft','scheduled','dispatched','picked_up','in_transit','delivered','invoiced','paid']

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id)
    return apiError('NOT_ONBOARDED', 'No organization', 400)

  if (!['owner', 'solo', 'dispatcher'].includes(profile.role))
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  const body = await request.json()
  const update: { driver_id?: number | null; truck_id?: number | null; status?: string } = {}

  // driver_id/truck_id are BIGINT FKs — null clears the assignment, anything
  // that isn't a number is a client error rather than something to pass through.
  for (const field of ['driver_id', 'truck_id'] as const) {
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

  // Log status change event
  if (update.status) {
    await supabase.from('load_events').insert({
      load_id:    Number(id),
      event_type: `status_${update.status}`,
      created_by: user.id,
    })
  }

  return NextResponse.json({ ok: true })
}
