// app/api/trucks/route.ts
import { createClient } from '@/lib/supabase/server'
import { generateTruckNumber } from '@/lib/generate-number'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) return NextResponse.json([], { status: 200 })

  const { data } = await supabase
    .from('trucks')
    .select('id, truck_number, nickname, year, make, model, license_plate, license_state, is_active')
    .eq('carrier_org_id', profile.org_id)
    .eq('is_active', true)
    .order('truck_number')

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
    return NextResponse.json({ error: 'No company' }, { status: 400 })

  if (!['owner', 'solo'].includes(profile.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()

  const truck_number = await generateTruckNumber(supabase, profile.org_id)

  const { data, error } = await supabase
    .from('trucks')
    .insert({
      carrier_org_id:    profile.org_id,
      truck_number,
      nickname:      body.nickname,
      year:          body.year          ?? null,
      make:          body.make          ?? null,
      model:         body.model         ?? null,
      vin:           body.vin           ?? null,
      license_plate: body.license_plate ?? null,
      license_state: body.license_state ?? null,
    })
    .select('truck_number, nickname')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
