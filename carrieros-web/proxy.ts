// proxy.ts (project root — Next.js 16 renamed `middleware.ts` to `proxy.ts`;
// the old filename silently does nothing, see decisions.md T1)
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Role → default landing route after login
const ROLE_HOME: Record<string, string> = {
  owner:      '/dashboard',
  solo:       '/dashboard',
  dispatcher: '/dispatch',
  finance:    '/finance',
  driver:     '/my-loads',
  sx_owner:   '/admin',
  sx_finance: '/admin',
  sx_support: '/admin',
}

// Routes that require a specific minimum role
// (checked AFTER auth — unauthenticated users hit the auth guard above)
const ROLE_ROUTES: { prefix: string; allowed: string[] }[] = [
  { prefix: '/dispatch', allowed: ['owner', 'solo', 'dispatcher'] },
  { prefix: '/finance',  allowed: ['owner', 'solo', 'finance'] },
  { prefix: '/my-loads', allowed: ['owner', 'solo', 'driver'] },
  { prefix: '/drivers',  allowed: ['owner', 'solo', 'dispatcher'] },
  { prefix: '/team',     allowed: ['owner', 'solo'] },
  // ShipmentX platform staff only — see lib/admin-auth.ts's SX_ROLES.
  // Symmetric with /team above: any non-sx_* role hitting /admin bounces
  // to their own tenant home, and (unlisted here, but implied) an sx_*
  // role hitting any tenant-only prefix above simply fails that prefix's
  // allowlist and bounces to /admin — no tenant data is exposed either way
  // since RLS scopes sx_* profiles to the platform org regardless.
  { prefix: '/admin',    allowed: ['sx_owner', 'sx_finance', 'sx_support'] },
]

// Public routes — no auth required
const PUBLIC_PREFIXES = ['/login', '/auth', '/track', '/onboarding']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  const isApiRoute = pathname.startsWith('/api/')

  // API routes authenticate themselves via lib/api-auth.ts, which accepts
  // EITHER a cookie session (web) OR an `Authorization: Bearer <token>`
  // header (carrieros-mobile — Expo has no cookies). This middleware's own
  // session check below only reads cookies, so it must not gate /api/*
  // requests — otherwise every Bearer-token request from mobile gets
  // redirected to /login before the route handler ever runs.
  if (isApiRoute) return NextResponse.next({ request })

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session (required — do NOT remove)
  const { data: { user } } = await supabase.auth.getUser()

  // ── Auth guard ──────────────────────────────────────────────
  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // ── New user with no org → onboarding ──────────────────────
  // (/api/ already returned above — this only ever runs for page routes)
  if (user && !isPublic && !pathname.startsWith('/onboarding')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, preferred_language')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.org_id) {
      return NextResponse.redirect(new URL('/onboarding', request.url))
    }

    // Sync the `locale` cookie from the source of truth (profiles.preferred_language,
    // decisions.md L2 — language follows the user, not the company). i18n/request.ts
    // reads this cookie; Server Components can't set cookies directly, so middleware
    // is where this has to happen. Only writes when it actually changed.
    const locale = profile.preferred_language ?? 'en'
    if (request.cookies.get('locale')?.value !== locale) {
      response.cookies.set('locale', locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
    }
  }

  // ── Redirect logged-in users away from /login ───────────────
  if (user && pathname.startsWith('/login')) {
    const profile = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile.data?.role ?? 'solo'
    const home = ROLE_HOME[role] ?? '/dashboard'
    return NextResponse.redirect(new URL(home, request.url))
  }

  // ── Role-based route guard ───────────────────────────────────
  if (user && !isPublic) {
    const matched = ROLE_ROUTES.find((r) => pathname.startsWith(r.prefix))
    if (matched) {
      const profile = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      const role = profile.data?.role ?? 'solo'
      if (!matched.allowed.includes(role)) {
        const home = ROLE_HOME[role] ?? '/dashboard'
        return NextResponse.redirect(new URL(home, request.url))
      }
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
