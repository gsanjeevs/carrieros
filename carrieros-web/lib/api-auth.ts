// lib/api-auth.ts
// Shared auth resolution for API routes callable from web (cookie session)
// AND carrieros-mobile (Bearer token — Expo has no cookies, sends the
// AsyncStorage-persisted access token as `Authorization: Bearer <token>`).
//
// Use this instead of raw createClient() in any API route that must be
// reachable from both clients. Routes that only ever run inside a browser
// (Server Components, Server Actions) can keep using createClient() directly.
//
// This is also the AuthProvider.getCurrentUser seam of docs/architecture-
// principles.md Rule G (the provider-adapter pattern) — a future non-
// Supabase auth swap only needs to change this one function's internals.
// It's already close to zero-leakage in practice: every one of the ~46
// call sites across the API surface only ever reads `.user.id` off the
// returned context, never any other Supabase-specific User field, so no
// interface change was needed to formalize this — the seam already exists,
// this comment just makes it explicit. See lib/storage/ and lib/auth-admin/
// for the same pattern applied where an interface *was* worth adding
// (storage and privileged admin operations, where the provider surface
// genuinely differs across clouds).

import { createClient as createServerClient, createAdminClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import type { User } from '@supabase/supabase-js'

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'NOT_ONBOARDED'
  | 'FORBIDDEN'
  | 'ALREADY_ONBOARDED'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'EXTRACTION_FAILED'
  | 'INVOICE_EXISTS'
  | 'LOAD_NOT_DELIVERED'
  | 'NOT_FACTORING'
  | 'EMAIL_SEND_FAILED'
  // Team management (app/api/team/*)
  | 'EMAIL_EXISTS'
  | 'PHONE_EXISTS'
  | 'SELF_ROLE_CHANGE'
  | 'CANNOT_REMOVE_SELF'
  | 'LAST_OWNER'
  | 'MANAGE_DRIVER_ELSEWHERE'
  | 'TIER_UPGRADE_REQUIRED'
  // Shipment commands (/api/v1)
  | 'VERSION_CONFLICT'
  | 'ILLEGAL_TRANSITION'
  | 'SERVER_ERROR'

// message is an English fallback for logs/devs only — never render it
// directly to end users. Each client maps `error_code` to a localized
// string via its own messages/{locale}.json (next-intl on web, i18n-js
// on mobile).
export function apiError(
  error_code: ErrorCode,
  message: string,
  status: number,
  meta?: Record<string, string | number | boolean | null>
) {
  return NextResponse.json({ error_code, error: message, ...(meta ? { meta } : {}) }, { status })
}

type AuthedContext = {
  supabase: ReturnType<typeof createSupabaseClient<Database>>
  user: User
}

// Resolves the caller's identity from either a Bearer token (mobile) or the
// cookie-based session (web). Returns a NextResponse to short-circuit with
// on failure, or the authed context to proceed with.
export async function getAuthedContext(
  request: NextRequest
): Promise<AuthedContext | NextResponse> {
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (bearerToken) {
    // Mobile path: validate the token against a plain (non-cookie) client.
    const supabase = createSupabaseClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${bearerToken}` } } }
    )
    const { data: { user }, error } = await supabase.auth.getUser(bearerToken)
    if (error || !user) return apiError('AUTH_REQUIRED', 'Invalid or expired token', 401)
    return { supabase, user }
  }

  // Web path: cookie-based session.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('AUTH_REQUIRED', 'Unauthorized', 401)
  return { supabase: supabase as unknown as AuthedContext['supabase'], user }
}

export function isErrorResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse
}

export { createAdminClient }
