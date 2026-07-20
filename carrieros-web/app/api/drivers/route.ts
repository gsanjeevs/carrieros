// app/api/drivers/route.ts
// GET lists drivers. Creating a driver is POST /api/drivers/invite — that
// endpoint sends the magic-link invite AND creates the drivers row in one
// step (see its header comment), since profile_id is NOT NULL and there's
// no pre-invite profile to attach to otherwise.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) return NextResponse.json([])

  // Join profiles for first_name/last_name (names live in profiles, not drivers)
  const { data } = await supabase
    .from('drivers')
    .select('id, driver_number, invite_status, default_truck_id, cdl_expiry, med_cert_expiry, is_active, profiles(first_name, last_name, phone)')
    .eq('carrier_org_id', profile.org_id)
    .eq('is_active', true)
    .order('driver_number')

  return NextResponse.json(data ?? [])
}
