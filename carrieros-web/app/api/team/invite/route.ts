// app/api/team/invite/route.ts
// Invite a back-office team member (dispatcher / finance / owner) via
// Supabase magic link — decision R3 (invite = magic link, no password) and
// R3b category 1 (needs a route because it uses the service-role Admin Auth
// API, which can never run in the browser).
//
// Mirrors app/api/drivers/invite/route.ts deliberately: same admin client,
// same "create the profiles row synchronously at invite time" choice, same
// stable error_code contract. The one difference is what it does NOT do —
// these roles must never get a `drivers` row. A driver invite creates one
// (and a driver_number); the /drivers flow owns that path and this route
// refuses the 'driver' and 'solo' roles outright so the two can't drift.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError, createAdminClient } from '@/lib/api-auth'

// Deliberately excludes 'driver' (has its own flow on /drivers, which also
// creates the drivers row) and 'solo' (owner+driver combined — only ever set
// at onboarding, decision P3).
export const INVITABLE_ROLES = ['dispatcher', 'finance', 'owner'] as const

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization found for this user', 400)
  if (!['owner', 'solo'].includes(profile.role))
    return apiError('FORBIDDEN', 'Only owner/solo can invite team members', 403)

  const body = await request.json()
  const { email, first_name, last_name, role } = body

  if (!email || typeof email !== 'string' || !email.includes('@'))
    return apiError('VALIDATION_ERROR', 'A valid email is required', 400)

  if (!INVITABLE_ROLES.includes(role))
    return apiError('VALIDATION_ERROR', `role must be one of ${INVITABLE_ROLES.join(', ')}`, 400)

  const admin = createAdminClient()
  const origin = new URL(request.url).origin

  // 1. Send the magic-link invite (creates the auth.users row).
  const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    email.trim(),
    {
      data: { org_id: profile.org_id, role },
      redirectTo: `${origin}/auth/callback`,
    }
  )

  if (inviteErr || !inviteData?.user) {
    // Supabase returns 422 "A user with this email address has already been
    // registered" — a routine, user-fixable case, not a 500.
    const msg = inviteErr?.message ?? ''
    if (inviteErr?.status === 422 || /already/i.test(msg))
      return apiError('EMAIL_EXISTS', msg || 'That email is already registered', 409)
    console.error('[team/invite] invite:', inviteErr)
    return apiError('SERVER_ERROR', msg || 'Failed to send invite', 500)
  }

  const newUserId = inviteData.user.id

  // 2. Create the profile row immediately (bypasses RLS via the admin client —
  // the invitee has no session yet to satisfy own_profile_insert).
  //    NOTE: no `drivers` row, and no driver_number allocation. These roles
  //    never drive; giving them one would put them in dispatch pickers.
  const { error: profileErr } = await admin.from('profiles').insert({
    id:         newUserId,
    org_id:     profile.org_id,
    role,
    first_name: typeof first_name === 'string' ? first_name.trim() || null : null,
    last_name:  typeof last_name === 'string' ? last_name.trim() || null : null,
  })

  if (profileErr) {
    // The auth.users row exists but has no profile — it would be a ghost that
    // can sign in with no org. Roll it back so the invite is all-or-nothing.
    console.error('[team/invite] profile:', profileErr)
    await admin.auth.admin.deleteUser(newUserId).catch(() => {})
    return apiError('SERVER_ERROR', profileErr.message, 500)
  }

  return NextResponse.json({ id: newUserId, email: email.trim(), role }, { status: 201 })
}
