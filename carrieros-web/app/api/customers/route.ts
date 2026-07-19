// app/api/customers/route.ts
// customers are now organizations (type='customer') + customer_details
import { createClient } from '@/lib/supabase/server'
import { generateCustomerNumber } from '@/lib/generate-number'
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
    .from('customer_details')
    .select('org_id, customer_number, contact_name, tags, notes, organizations(id, name, email, phone, city, state)')
    .eq('carrier_org_id', profile.org_id)
    .order('org_id')

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

  if (!['owner', 'solo', 'dispatcher'].includes(profile.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()

  // 1. Create the organization row
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({
      type:    'customer',
      name:    body.name,
      phone:   body.phone   ?? null,
      email:   body.email   ?? null,
      address: body.address ?? null,
      city:    body.city    ?? null,
      state:   body.state   ?? null,
      zip:     body.zip     ?? null,
      country: body.country ?? 'US',
    })
    .select('id, name')
    .single()

  if (orgError) return NextResponse.json({ error: orgError.message }, { status: 500 })

  // 2. Generate customer number and create customer_details
  const customer_number = await generateCustomerNumber(supabase, profile.org_id)

  const { error: detailError } = await supabase
    .from('customer_details')
    .insert({
      org_id:         org.id,
      carrier_org_id: profile.org_id,
      customer_number,
      contact_name:   body.contact_name ?? null,
      notes:          body.notes        ?? null,
    })

  if (detailError) return NextResponse.json({ error: detailError.message }, { status: 500 })

  return NextResponse.json({ org_id: org.id, name: org.name, customer_number }, { status: 201 })
}
