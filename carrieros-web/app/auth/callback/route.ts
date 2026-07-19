// app/auth/callback/route.ts
// Handles magic link + OAuth redirects from Supabase
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/supabase'

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
  const next = searchParams.get('next') ?? '/'

  if (!code) {
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

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] error:', error.message)
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  // Get role and redirect to role home
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role ?? 'solo'
    const home = ROLE_HOME[role] ?? '/dashboard'

    // If 'next' is a safe internal path, use it; otherwise use role home
    const destination = next.startsWith('/') ? next : home
    return NextResponse.redirect(`${origin}${destination}`)
  }

  return NextResponse.redirect(`${origin}/login`)
}
