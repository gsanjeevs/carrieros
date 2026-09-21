// app/auth/callback/route.ts
// Handles magic link + OAuth redirects from Supabase
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { getProfileForUser } from '@/lib/queries/profiles'
import { logError } from '@/lib/observability'

const ROLE_HOME: Record<string, string> = {
  owner:      '/dashboard',
  solo:       '/dashboard',
  dispatcher: '/dispatch',
  finance:    '/finance',
  driver:     '/my-loads',
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Admin-issued links (invite, and any other type sent via the Admin Auth
  // API rather than a browser-initiated signInWithOtp/OAuth call) have no
  // PKCE code_verifier to redeem against, so GoTrue can't hand back a
  // `code`. Our invite email template (supabase/templates/invite.html)
  // instead links here with token_hash + type, verified via verifyOtp —
  // same destination, same role-redirect logic below either way.
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  // No caller currently passes `next` (neither the team nor drivers invite
  // route sets it on redirectTo). Defaulting it to '/' would trivially pass
  // the startsWith('/') check below and silently win over the role-based
  // `home`, so every invited user would land on /dashboard regardless of
  // role. Only trust `next` when the request actually supplied one.
  const nextParam = searchParams.get('next')

  if (!code && !token_hash) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const cookieStore = await cookies()
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ type: type ?? 'invite', token_hash: token_hash! })

  if (error) {
    logError({ route: 'auth/callback', requestId: request.headers.get('x-request-id') }, error)
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  // Get role and redirect to role home
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: profile } = await getProfileForUser(supabase, user.id)

    const role = profile?.role ?? 'solo'
    const home = ROLE_HOME[role] ?? '/dashboard'

    // If 'next' is a safe internal path, use it; otherwise use role home
    const destination = nextParam && nextParam.startsWith('/') ? nextParam : home
    return NextResponse.redirect(`${origin}${destination}`)
  }

  return NextResponse.redirect(`${origin}/login`)
}
