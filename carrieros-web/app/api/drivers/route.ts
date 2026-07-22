// app/api/drivers/route.ts
// GET lists drivers. Creating a driver is POST /api/drivers/invite — that
// endpoint sends the magic-link invite AND creates the drivers row in one
// step (see its header comment), since profile_id is NOT NULL and there's
// no pre-invite profile to attach to otherwise.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'

export async function GET(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) return NextResponse.json([])

  // Join profiles for first_name/last_name (names live in profiles, not drivers)
  const { data } = await supabase
    .from('drivers')
    .select('id, driver_number, invite_status, default_vehicle_id, cdl_expiry, med_cert_expiry, is_active, profiles(first_name, last_name, phone)')
    .eq('carrier_org_id', profile.org_id)
    .eq('is_active', true)
    .order('driver_number')

  // Rule C (docs/architecture-principles.md) — flatten the Postgrest
  // `profiles(...)` embed into top-level fields rather than leaking the
  // join's nested shape onto the wire; consumers (DispatchPanel.tsx) read
  // first_name/last_name directly, not a nested `profiles` object.
  const drivers = (data ?? []).map((d) => ({
    id: d.id,
    driver_number: d.driver_number,
    invite_status: d.invite_status,
    default_vehicle_id: d.default_vehicle_id,
    cdl_expiry: d.cdl_expiry,
    med_cert_expiry: d.med_cert_expiry,
    is_active: d.is_active,
    first_name: d.profiles?.first_name ?? null,
    last_name: d.profiles?.last_name ?? null,
    phone: d.profiles?.phone ?? null,
  }))

  return NextResponse.json(drivers)
}
