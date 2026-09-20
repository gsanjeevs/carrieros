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
import { hasFeature } from '@/lib/entitlements'
import { logError } from '@/lib/observability'
import { getProfileForUser, insertProfile } from '@/lib/queries/profiles'
import { createAuthAdminProvider } from '@/lib/auth-admin'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

// Deliberately excludes 'driver' (has its own flow on /drivers, which also
// creates the drivers row) and 'solo' (owner+driver combined — only ever set
// at onboarding, decision P3).
export const INVITABLE_ROLES = ['dispatcher', 'finance', 'owner'] as const

// DEMO-MODE SEAM (2026-07-22, same philosophy as lib/stripe.ts's
// createStripeCustomer() and app/api/settlements/[id]/send-ach/route.ts's
// sendAchTransfer()): no SMS provider (Twilio or equivalent) is configured
// in this project. This does not send a text message — it logs what would
// be sent, so the phone-invite data model (auth.users row with a confirmed
// phone, no password) is real and complete, and a real provider can drop in
// behind this function without changing anything else in the route.
function sendPhoneInviteSms(params: { phone: string; role: string }): void {
  console.log(
    '[team-invite:sms-stub] no SMS provider is configured — no text was sent.',
    JSON.stringify(params)
  )
}

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization found for this user', 400)
  if (!roleHasCapability(profile.role, 'team_manage'))
    return apiError('FORBIDDEN', 'Only owner/solo can invite team members', 403)

  const body = await request.json()
  const { email, phone, first_name, last_name, role } = body

  const hasEmail = typeof email === 'string' && email.trim().includes('@')
  const hasPhone = typeof phone === 'string' && /^\+?[0-9]{7,15}$/.test(phone.trim())

  if (!hasEmail && !hasPhone)
    return apiError('VALIDATION_ERROR', 'A valid email or phone number is required', 400)

  if (!INVITABLE_ROLES.includes(role))
    return apiError('VALIDATION_ERROR', `role must be one of ${INVITABLE_ROLES.join(', ')}`, 400)

  // Added 2026-07-21: BRD §9 puts Dispatcher/Finance at Growth+ (Owner/Solo
  // are all-tier) -- this was previously unenforced anywhere, confirmed by
  // reading this file directly. has_feature() is the same RLS-usable gate
  // Phase 6 will use; called here via RPC in the caller's own session.
  if (role === 'dispatcher' || role === 'finance') {
    const entitled = await hasFeature(supabase, 'dispatcher_finance_roles')
    if (!entitled) {
      return apiError(
        'TIER_UPGRADE_REQUIRED',
        'Dispatcher and Finance roles require the Growth plan or above',
        403
      )
    }
  }

  const admin = createAdminClient()
  const authAdmin = createAuthAdminProvider(admin)
  const origin = new URL(request.url).origin

  // 1. Create the identity via whichever contact method was given. Email is
  // the fully-working path (real magic-link delivery); phone-only creates a
  // real auth.users row with a confirmed phone but does not send a real SMS
  // — see sendPhoneInviteSms()'s comment.
  const { data: inviteData, error: inviteErr } = hasEmail
    ? await authAdmin.inviteUserByEmail(email.trim(), {
        data: { org_id: profile.org_id, role },
        redirectTo: `${origin}/auth/callback`,
      })
    : await authAdmin.createUserWithPhone(phone.trim(), {
        data: { org_id: profile.org_id, role },
      })

  if (inviteErr || !inviteData?.user) {
    // Supabase returns 422 "A user with this email address has already been
    // registered" — a routine, user-fixable case, not a 500.
    const msg = inviteErr?.message ?? ''
    if (inviteErr?.status === 422 || /already/i.test(msg))
      return apiError(hasEmail ? 'EMAIL_EXISTS' : 'PHONE_EXISTS', msg || 'That contact is already registered', 409)
    logError({ route: 'api/team/invite', userId: user.id, orgId: profile.org_id }, inviteErr)
    return apiError('SERVER_ERROR', msg || 'Failed to send invite', 500)
  }

  const newUserId = inviteData.user.id

  if (hasPhone && !hasEmail) {
    sendPhoneInviteSms({ phone: phone.trim(), role })
  }

  // 2. Create the profile row immediately (bypasses RLS via the admin client —
  // the invitee has no session yet to satisfy own_profile_insert).
  //    NOTE: no `drivers` row, and no driver_number allocation. These roles
  //    never drive; giving them one would put them in dispatch pickers.
  const { error: profileErr } = await insertProfile(admin, {
    id:         newUserId,
    org_id:     profile.org_id,
    role,
    first_name: typeof first_name === 'string' ? first_name.trim() || null : null,
    last_name:  typeof last_name === 'string' ? last_name.trim() || null : null,
    phone:      hasPhone ? phone.trim() : null,
  })

  if (profileErr) {
    // The auth.users row exists but has no profile — it would be a ghost that
    // can sign in with no org. Roll it back so the invite is all-or-nothing.
    logError({ route: 'api/team/invite', userId: user.id, orgId: profile.org_id }, profileErr, {
      rolled_back_auth_user: newUserId,
    })
    await authAdmin.deleteUser(newUserId).catch(() => {})
    return apiError('SERVER_ERROR', profileErr.message, 500)
  }

  return NextResponse.json(
    { id: newUserId, email: hasEmail ? email.trim() : null, phone: hasPhone ? phone.trim() : null, role },
    { status: 201 }
  )
}
