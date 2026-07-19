// app/api/drivers/route.ts
import { createClient } from '@/lib/supabase/server'
import { generateDriverNumber } from '@/lib/generate-number'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) return NextResponse.json([], { status: 200 })

  // Join profiles for first_name/last_name (names live in profiles, not drivers)
  const { data } = await supabase
    .from('drivers')
    .select('id, driver_number, invite_status, default_truck_id, cdl_expiry, med_cert_expiry, is_active, profiles(first_name, last_name, phone)')
    .eq('carrier_org_id', profile.org_id)
    .eq('is_active', true)
    .order('driver_number')

  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
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

  if (!['owner', 'solo'].includes(profile.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()

  // body must include profile_id — caller creates profile via Supabase admin invite first
  if (!body.profile_id)
    return NextResponse.json({ error: 'profile_id required (invite driver first)' }, { status: 400 })

  const driver_number = await generateDriverNumber(supabase, profile.org_id)

  const { data, error } = await supabase
    .from('drivers')
    .insert({
      carrier_org_id:   profile.org_id,
      profile_id:       body.profile_id,
      driver_number,
      default_truck_id: body.default_truck_id ?? null,
      invite_status:    'pending',
    })
    .select('driver_number, invite_status')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
