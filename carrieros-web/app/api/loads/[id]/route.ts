// app/api/loads/[id]/route.ts
// PATCH — update driver, truck, and/or status on a load
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const VALID_STATUSES = ['draft','scheduled','dispatched','picked_up','in_transit','delivered','invoiced','paid']

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id)
    return NextResponse.json({ error: 'No organization' }, { status: 400 })

  if (!['owner', 'solo', 'dispatcher'].includes(profile.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()
  const update: Record<string, unknown> = {}

  if ('driver_id' in body) update.driver_id = body.driver_id ?? null
  if ('truck_id'  in body) update.truck_id  = body.truck_id  ?? null
  if ('status' in body) {
    if (!VALID_STATUSES.includes(body.status))
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    update.status = body.status
  }

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { error } = await supabase
    .from('loads')
    .update(update)
    .eq('id', Number(id))
    .eq('carrier_org_id', profile.org_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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
