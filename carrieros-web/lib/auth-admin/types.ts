// lib/auth-admin/types.ts
// Provider-agnostic seam for privileged auth operations (docs/architecture-
// principles.md Rule G) — the ~9 files that call `admin.auth.admin.*`
// directly today (invite, delete, impersonate, cron digest lookups). Plain
// session resolution (`getAuthedContext` in lib/api-auth.ts) is a separate,
// already-centralized seam — this one is specifically the *admin* API
// surface (createAdminClient()'s service-role operations), which is where
// providers differ most (Cognito's admin API shape has little in common
// with Supabase's).
//
// Return shape deliberately mirrors supabase-js's own `{ data, error }`
// convention rather than inventing a new one — minimizes the diff at every
// call site today, and a future CognitoAuthAdminProvider just needs to
// produce the same envelope, not push a different error-handling style onto
// every caller.
export interface AuthAdminUser {
  id: string
  email: string | null
  lastSignInAt: string | null
}

export interface AuthAdminError {
  message: string
  status?: number
}

export interface AuthAdminProvider {
  listUsers(opts?: { page?: number; perPage?: number }): Promise<{
    data: { users: AuthAdminUser[] } | null
    error: AuthAdminError | null
  }>

  getUserById(userId: string): Promise<{
    data: { user: AuthAdminUser | null } | null
    error: AuthAdminError | null
  }>

  inviteUserByEmail(
    email: string,
    opts?: { data?: Record<string, unknown>; redirectTo?: string }
  ): Promise<{
    data: { user: AuthAdminUser } | null
    error: AuthAdminError | null
  }>

  deleteUser(userId: string): Promise<{ error: AuthAdminError | null }>

  // Phone-only invite path (team invite, PRD: "invite by phone number or
  // email"). Creates the auth.users row with a confirmed phone and no
  // password — actually notifying the invitee (SMS) is a demo-mode seam,
  // same philosophy as lib/stripe.ts's createStripeCustomer(): no SMS
  // provider (Twilio/etc) is configured in this project, so the identity/
  // data model is real and complete, but no text message is actually sent.
  // See app/api/team/invite/route.ts's sendPhoneInviteSms() stub.
  createUserWithPhone(
    phone: string,
    opts?: { data?: Record<string, unknown> }
  ): Promise<{
    data: { user: AuthAdminUser } | null
    error: AuthAdminError | null
  }>

  generateMagicLink(
    email: string,
    opts?: { redirectTo?: string }
  ): Promise<{
    data: { actionLink: string } | null
    error: AuthAdminError | null
  }>
}
