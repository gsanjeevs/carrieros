// proxy.ts (project root — Next.js 16 renamed `middleware.ts` to `proxy.ts`;
// the old filename silently does nothing, see decisions.md T1)
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability, type RoleCapability } from '@/lib/generated/role-capabilities'

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

// Routes that require a specific minimum role, expressed as the
// RoleCapability each prefix needs (lib/generated/role-capabilities.ts,
// backed by supabase/migrations/0009_role_capabilities.sql — the same
// table carrieros-mobile consumes, so the two apps can't drift the way
// hand-written role arrays already did once).
// (checked AFTER auth — unauthenticated users hit the auth guard above)
const ROLE_ROUTES: { prefix: string; capability: RoleCapability }[] = [
  { prefix: '/dispatch', capability: 'dispatch' },
  { prefix: '/finance',  capability: 'finance' },
  { prefix: '/my-loads', capability: 'my_loads' },
  { prefix: '/drivers',  capability: 'drivers' },
  { prefix: '/team',     capability: 'team' },
  // /dashboard itself has no per-tenant-role guard (dashboard/page.tsx
  // branches internally per role, per task #49's fallback fix) — but it was
  // never guarded against sx_* roles landing there at all. Since
  // signInWithEmail (app/login/actions.ts) always redirects to /dashboard
  // and relies on this middleware to bounce non-tenant roles onward, an
  // sx_* login without this entry fell through with no matching prefix and
  // landed on dashboard/page.tsx's "no dashboard view built for this role"
  // placeholder instead of /admin — found via this session's admin-UI
  // browser verification, not a security issue (no cross-org data exposed)
  // but a real broken-landing-page regression.
  { prefix: '/dashboard', capability: 'dashboard' },
  // ShipmentX platform staff only — see lib/admin-auth.ts's SX_ROLES.
  // Symmetric with /team above: any non-sx_* role hitting /admin bounces
  // to their own tenant home, and (unlisted here, but implied) an sx_*
  // role hitting any tenant-only prefix above simply fails that prefix's
  // allowlist and bounces to /admin — no tenant data is exposed either way
  // since RLS scopes sx_* profiles to the platform org regardless.
  { prefix: '/admin',    capability: 'admin' },
]

// Public routes — no auth required
const PUBLIC_PREFIXES = ['/login', '/signup', '/auth', '/track', '/onboarding']

// carrieros-mobile's apiFetch() (src/lib/api.ts) is a cross-origin caller
// when running as Expo web (localhost:8081 -> :3000) — native iOS/Android
// builds aren't subject to CORS, but the web preview is a real browser and
// needs the preflight (OPTIONS) handled and the actual response to carry
// Access-Control-Allow-Origin, or every apiFetch call fails with "Failed to
// fetch" before lib/api-auth.ts's Bearer-token check ever runs. Page routes
// are untouched — same-origin requests ignore these headers entirely.
const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

// Every request gets an id (honouring one supplied by an upstream proxy/load
// balancer). It is forwarded to route handlers as the `x-request-id` request
// header -- lib/observability.ts logs it -- and echoed on the response so a
// user-reported failure can be matched to a log line and a tracker event.
export async function proxy(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
  const response = await handle(request, requestId)
  response.headers.set('x-request-id', requestId)
  return response
}

async function handle(request: NextRequest, requestId: string) {
  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  const isApiRoute = pathname.startsWith('/api/')

  // API routes authenticate themselves via lib/api-auth.ts, which accepts
  // EITHER a cookie session (web) OR an `Authorization: Bearer <token>`
  // header (carrieros-mobile — Expo has no cookies). This middleware's own
  // session check below only reads cookies, so it must not gate /api/*
  // requests — otherwise every Bearer-token request from mobile gets
  // redirected to /login before the route handler ever runs.
  if (isApiRoute) {
    const origin = request.headers.get('origin') ?? '*'

    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Origin': origin, ...CORS_HEADERS },
      })
    }

    const forwardedHeaders = new Headers(request.headers)
    forwardedHeaders.set('x-request-id', requestId)
    const apiResponse = NextResponse.next({ request: { headers: forwardedHeaders } })
    apiResponse.headers.set('Access-Control-Allow-Origin', origin)
    apiResponse.headers.set('Access-Control-Expose-Headers', 'x-request-id')
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      apiResponse.headers.set(key, value)
    }
    return apiResponse
  }

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
    const profile = await getProfileForUser(supabase, user.id)

    const role = profile.data?.role ?? 'solo'
    const home = ROLE_HOME[role] ?? '/dashboard'
    return NextResponse.redirect(new URL(home, request.url))
  }

  // ── Role-based route guard ───────────────────────────────────
  if (user && !isPublic) {
    const matched = ROLE_ROUTES.find((r) => pathname.startsWith(r.prefix))
    if (matched) {
      const profile = await getProfileForUser(supabase, user.id)

      const role = profile.data?.role ?? 'solo'
      if (!roleHasCapability(role, matched.capability)) {
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
