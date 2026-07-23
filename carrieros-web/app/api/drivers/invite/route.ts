// app/api/drivers/invite/route.ts
// Invite a driver via Supabase magic link (decision R3, docs/decisions.md).
// Server-only: uses createAdminClient() (service role) to call the Supabase
// Admin Auth API and to bootstrap the profiles + drivers rows, since the
// invitee has no session yet and can't satisfy RLS themselves (same
// bootstrapping paradox as /api/onboarding — see decision T3).
//
// Design choice: the profile + drivers rows are created synchronously here,
// at invite time, rather than deferred to first sign-in. This keeps
// drivers.profile_id NOT NULL intact (no schema relaxation) and avoids a
// second profile-creation code path in app/auth/callback/route.ts. The
// invitee still must click the magic link to authenticate; only the DB rows
// exist ahead of that.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError, createAdminClient } from '@/lib/api-auth'
import { generateDriverNumber } from '@/lib/generate-number'
import { getProfileForUser } from '@/lib/queries/profiles'
import { createAuthAdminProvider } from '@/lib/auth-admin'

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization found for this user', 400)
  if (!['owner', 'solo'].includes(profile.role))
    return apiError('FORBIDDEN', 'Only owner/solo can invite drivers', 403)

  const body = await request.json()
  const { email, phone, first_name, last_name, default_vehicle_id } = body

  if (!email || typeof email !== 'string')
    return apiError('VALIDATION_ERROR', 'email is required', 400)

  const admin = createAdminClient()
  const origin = new URL(request.url).origin

  // 1. Send the magic-link invite (creates the auth.users row).
  const { data: inviteData, error: inviteErr } = await createAuthAdminProvider(admin).inviteUserByEmail(email, {
    data: { org_id: profile.org_id, role: 'driver' },
    redirectTo: `${origin}/auth/callback`,
  })

  if (inviteErr || !inviteData?.user) {
    console.error('[drivers/invite] invite:', inviteErr)
    return apiError('SERVER_ERROR', inviteErr?.message ?? 'Failed to send invite', 500)
  }

  const newUserId = inviteData.user.id

  // 2. Create the profile row immediately (bypasses RLS via admin client —
  // the invitee has no session yet to satisfy own_profile_insert).
  const { error: profileErr } = await admin.from('profiles').insert({
    id:         newUserId,
    org_id:     profile.org_id,
    role:       'driver',
    first_name: first_name?.trim() || null,
    last_name:  last_name?.trim()  || null,
    phone:      phone ?? null,
  })

  if (profileErr) {
    console.error('[drivers/invite] profile:', profileErr)
    return apiError('SERVER_ERROR', `[step1] ${profileErr.message}`, 500)
  }

  // 3. Generate driver_number (next_entity_val takes org_id explicitly —
  // no auth.uid() dependency, safe to call via the admin client).
  const driver_number = await generateDriverNumber(admin, profile.org_id)

  // 4. Create the drivers row.
  const { data: driver, error: driverErr } = await admin
    .from('drivers')
    .insert({
      carrier_org_id:    profile.org_id,
      profile_id:        newUserId,
      driver_number,
      default_vehicle_id:  default_vehicle_id ?? null,
      invite_status:     'pending',
    })
    .select('driver_number, invite_status')
    .single()

  if (driverErr) {
    console.error('[drivers/invite] drivers row:', driverErr)
    return apiError('SERVER_ERROR', `[step2] ${driverErr.message}`, 500)
  }

  return NextResponse.json(
    { driver_number: driver.driver_number, invite_status: driver.invite_status },
    { status: 201 }
  )
}
