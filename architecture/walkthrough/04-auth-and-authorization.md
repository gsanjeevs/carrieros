# 04 — Authentication and Authorization

## 1. Purpose

`carrieros-web` has three distinct kinds of caller, and the system tells them
apart differently:

1. **Tenant users** — carrier staff (owner, solo, dispatcher, finance,
   driver) and customer users (customer_admin, customer_viewer), each
   belonging to exactly one `organizations` row via `profiles.org_id`. They
   authenticate with a normal Supabase Auth session (cookie on web, bearer
   token on mobile) and are scoped to their own org's data.
2. **ShipmentX platform staff (SuperAdmin)** — internal ShipmentX employees
   who use the **same** Supabase Auth session machinery as tenant users, but
   their `profiles` row lives in a special `'platform'`-type organization and
   carries one of the roles `sx_owner`, `sx_finance`, `sx_support`. There is
   **no separate admin auth system** — this is a deliberate design decision
   (`carrieros-web/lib/admin-auth.ts:1-8`).
3. **Third-party API clients** — external developers calling
   `/api/public/v1/**` never get a Supabase session at all. They authenticate
   as an *organization* via an OAuth 2.0 client-credentials grant and receive
   a short-lived signed JWT that carries `org_id`, `client_id`, and a fixed
   `scope: 'read'`.

Two mechanisms do the actual scoping, layered on top of each other:

- **Role-based capabilities** (`lib/generated/role-capabilities.ts`) — an
  application-layer table of "which role can do which named action," checked
  in route guards, application services, and UI gating.
- **Row Level Security (RLS)** in Postgres, keyed off `my_org_id()` /
  `my_role()` — the database-layer backstop that enforces tenant isolation
  regardless of what the application code does or forgets to do. Per ADR
  0003, RLS is intentionally kept as defense in depth even after application
  code is migrated to go through one shared API layer.

## 2. File structure

```
carrieros-web/
├── proxy.ts                          # Next.js 16's replacement for middleware.ts (see §3).
│                                      # Runs on every request: session refresh, auth guard,
│                                      # onboarding redirect, role→capability route gate.
├── lib/
│   ├── supabase/
│   │   ├── server.ts                 # createClient() = RLS-scoped (anon key + user cookies);
│   │   │                             # createAdminClient() = service-role, bypasses RLS.
│   │   └── client.ts                 # Browser-side Supabase client.
│   ├── api-auth.ts                   # getAuthedContext(): resolves caller identity for
│   │                                 # /api/** routes from EITHER a cookie session (web) OR
│   │                                 # an Authorization: Bearer token (carrieros-mobile).
│   ├── admin-auth.ts                 # requireAdminRole(): the SuperAdmin console's own
│   │                                 # guard — checks sx_* role + capability, then hands
│   │                                 # back a service-role client for cross-tenant reads.
│   ├── public-api-auth.ts            # JWT sign/verify + ActorContext bridge for the
│   │                                 # public developer API's OAuth2 client-credentials flow.
│   ├── auth-admin/                   # Provider-adapter around Supabase's privileged
│   │   ├── index.ts                  # `auth.admin.*` operations (list/invite/delete users,
│   │   ├── types.ts                  # generate magic links) — the seam for swapping identity
│   │   └── supabase-auth-admin-provider.ts   # providers later without touching call sites.
│   └── generated/
│       └── role-capabilities.ts      # GENERATED. Single source of truth for role→capability,
│                                      # shared verbatim with carrieros-mobile.
├── server/
│   ├── domain/shared/identity.ts     # ActorContext type: {userId, orgId, role,
│   │                                 # isPlatformOperator, correlationId} — what every
│   │                                 # application service receives, regardless of caller kind.
│   ├── infrastructure/supabase/
│   │   └── actor-context.ts          # buildActorContext(): turns a verified Supabase user
│   │                                 # into an ActorContext by reading THEIR OWN profile row.
│   └── application/
│       └── public-api-token-service.ts   # The OAuth client-credentials grant logic itself
│                                          # (verifies client_id/secret, checks entitlement).
├── app/
│   ├── (app)/layout.tsx              # Tenant app shell: session check + profile fetch.
│   ├── (admin)/admin/layout.tsx      # SuperAdmin shell: session check + sx_* role check
│   │                                 # (defense in depth on top of proxy.ts's route gate).
│   └── api/public/v1/
│       ├── oauth/token/route.ts      # Issues the client-credentials JWT.
│       └── loads/route.ts            # Example public-API route consuming the JWT.
└── supabase/
    ├── schema/schema.sql             # SECTION 8: RLS helper functions (my_org_id, my_role,
    │                                 # my_driver_id) and all CREATE POLICY statements.
    └── migrations/                   # Incremental migrations, including 0009 (role_capabilities)
                                       # and 0023 (action capabilities).
```

## 3. Key files

### (a) `proxy.ts` — the session/route gate every page request passes through

Next.js 16 renamed `middleware.ts` to `proxy.ts` (the old filename now
silently does nothing — see `carrieros-web/proxy.ts:1-2`). This file runs on
every non-static request. For page routes it refreshes the Supabase session,
redirects unauthenticated users to `/login`, redirects users with no
`org_id` yet to `/onboarding`, and enforces a role→capability map on route
prefixes:

```ts
// carrieros-web/proxy.ts:33-57
const ROLE_ROUTES: { prefix: string; capability: RoleCapability }[] = [
  { prefix: '/dispatch', capability: 'dispatch' },
  { prefix: '/finance',  capability: 'finance' },
  { prefix: '/my-loads', capability: 'my_loads' },
  { prefix: '/drivers',  capability: 'drivers' },
  { prefix: '/team',     capability: 'team' },
  { prefix: '/dashboard', capability: 'dashboard' },
  // ShipmentX platform staff only — see lib/admin-auth.ts's SX_ROLES.
  { prefix: '/admin',    capability: 'admin' },
]
```

```ts
// carrieros-web/proxy.ts:228-240
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
```

Note `/api/*` routes are explicitly excluded from this cookie-only session
check (`carrieros-web/proxy.ts:91-96`) — API routes authenticate themselves
via `lib/api-auth.ts`, which also accepts mobile's bearer token, and gating
them here would break every mobile request before the route handler runs.

### (b) `lib/api-auth.ts` — how a normal request gets authenticated (web + mobile)

`getAuthedContext()` is the shared identity-resolution seam for any
`/api/**` route reachable from both `carrieros-web` and `carrieros-mobile`:

```ts
// carrieros-web/lib/api-auth.ts:80-103
export async function getAuthedContext(
  request: NextRequest
): Promise<AuthedContext | NextResponse> {
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (bearerToken) {
    // Mobile path: validate the token against a plain (non-cookie) client.
    const supabase = createSupabaseClient<Database>(/* ... */)
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
```

The returned `supabase` client is always the caller's own RLS-scoped client
(created with the anon key, not service role) — every downstream query made
with it is subject to RLS. Org scoping is derived one layer up, in
`buildActorContext()` (see §4), by reading the caller's *own* `profiles`
row — never from request input.

### (c) `supabase/schema/schema.sql` — RLS enforces tenant isolation at the DB layer

Two `SECURITY DEFINER` helper functions resolve the caller's org and role
from their own `profiles` row, bypassing RLS on `profiles` itself to avoid
recursive-policy errors:

```sql
-- supabase/schema/schema.sql:1616-1634
CREATE OR REPLACE FUNCTION my_org_id()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid() AND is_active = true
$$;

CREATE OR REPLACE FUNCTION my_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid() AND is_active = true
$$;
```

Both return `NULL` for a deactivated profile (`is_active = false`), which
denies every policy built on them. Every tenant table's policies key off
these two functions, e.g. on `loads`:

```sql
-- supabase/schema/schema.sql:1894-1926
ALTER TABLE loads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_solo_loads_all" ON loads FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);
CREATE POLICY "dispatcher_loads_select" ON loads FOR SELECT USING (
  carrier_org_id = my_org_id()
  AND my_role() = 'dispatcher'
);
...
CREATE POLICY "driver_own_loads_select" ON loads FOR SELECT USING (
  driver_id = my_driver_id()
);
```

This is the tenant-isolation boundary: whatever the application code does or
fails to filter, Postgres itself will not return a row belonging to a
different `carrier_org_id` (or, for drivers, a different `driver_id`) to an
authenticated session.

### (d) `app/(admin)/admin/layout.tsx` + `lib/admin-auth.ts` — the SuperAdmin path

There is no separate SuperAdmin auth system. ShipmentX staff sign in with
the exact same magic-link/session machinery as tenant users; what's
different is that their `profiles` row belongs to a `'platform'`-type
`organizations` row with role `sx_owner` / `sx_finance` / `sx_support`
(`carrieros-web/lib/admin-auth.ts:1-8`). The `/admin` route group re-checks
this server-side, in addition to `proxy.ts`'s route gate, as defense in
depth:

```ts
// carrieros-web/app/(admin)/admin/layout.tsx:23-29
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) redirect('/login')

const { data: profile } = await getProfileForUser(supabase, user.id)
if (!profile || !SX_ROLES.includes(profile.role)) redirect('/dashboard')
```

Because an sx_* profile's own `my_org_id()` still resolves to ShipmentX's
own platform org, its **own session is still subject to normal RLS** and
cannot see tenant data (loads, invoices, carrier_details, etc.) through
ordinary queries — those tables have no "or is platform staff" exception in
their policies, by explicit design (`supabase/schema/schema.sql:987-996`).
Instead, every `/api/admin/**` route calls `requireAdminRole()` first, which
authorizes the sx_* role/capability, then does its cross-tenant reads
through a **service-role client** that bypasses RLS entirely:

```ts
// carrieros-web/lib/admin-auth.ts:39-57
export async function requireAdminRole(
  request: NextRequest,
  capability: RoleCapability = 'admin'
): Promise<AdminContext | NextResponse> {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)
  const role = profile?.role as SxRole | undefined
  if (!role || !SX_ROLES.includes(role))
    return apiError('FORBIDDEN', 'ShipmentX admin access required', 403)

  if (!roleHasCapability(role, capability))
    return apiError('FORBIDDEN', 'Your ShipmentX role cannot perform this action', 403)

  return { admin: createAdminClient(), userId: user.id, role }
}
```

In other words: for the SuperAdmin surface, **the application-code role
check IS the authorization boundary** (there is no RLS backstop, because the
service-role client ignores RLS entirely). This is called out explicitly in
the file's own header comment as the one place in the codebase where that's
true.

### (e) `lib/public-api-auth.ts` + `server/application/public-api-token-service.ts` — public API OAuth2 → role mapping

External developers hit `/api/public/v1/oauth/token` with a client-credentials
grant. `PublicApiTokenService.issueToken()` rate-limits by claimed
`client_id`, verifies the secret, re-checks the org's plan entitlement, and
returns claims (`carrieros-web/server/application/public-api-token-service.ts:28-70`).
`lib/public-api-auth.ts` then signs those claims into a 1-hour JWT
(`orgId`, `clientId`, `scope: 'read'`), pinning the algorithm explicitly to
avoid alg-confusion attacks:

```ts
// carrieros-web/lib/public-api-auth.ts:67-77
const decoded = jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] })
...
const orgId = decoded.org_id
const clientId = decoded.client_id
const scope = decoded.scope
if (typeof orgId !== 'number' || typeof clientId !== 'string' || scope !== 'read') {
  return publicApiError('invalid_token', 'Malformed token', 401)
}
```

The verified claims are then turned into an `ActorContext` — the same
struct every internal application service (like `LoadQueryService`)
consumes — via `buildPublicApiActor()`:

```ts
// carrieros-web/lib/public-api-auth.ts:104-112
export function buildPublicApiActor(claims: PublicApiTokenClaims): ActorContext {
  return {
    userId: asUserId(`public-api:${claims.clientId}`),
    orgId: claims.orgId,
    role: 'finance',
    isPlatformOperator: false,
    correlationId: asCorrelationId(crypto.randomUUID()),
  }
}
```

`role: 'finance'` is a **deliberate reuse**, not a placeholder: of the
existing tenant roles, `finance` is the only one whose
`role_capabilities` set is exactly the read/rate-visibility footprint a
read-only external integration needs (`loads_view`, `invoice_actions`,
`rate_visibility`) with none of `owner`'s administrative capabilities. See
the capability table itself:

```ts
// carrieros-web/lib/generated/role-capabilities.ts (excerpt)
finance: ['customers_view', 'dashboard', 'documents_read', 'finance', 'invoice_actions',
          'loads_view', 'org_documents_view', 'rate_visibility', 'settings_view',
          'settlements_manage', 'settlements_view'],
```

This means every public API request is, from the application layer's point
of view, indistinguishable from a `finance`-role tenant user scoped to
`claims.orgId` — same `ActorContext`, same application services, same
capability checks.

## 4. How to trace a request end-to-end

Example: a logged-in **dispatcher** loads `GET /loads` (the web loads list
page, `app/(app)/loads/page.tsx`).

1. **`proxy.ts` (every request)** — refreshes the Supabase session from
   cookies, confirms `user` is non-null, confirms `profiles.org_id` is set
   (else redirect to `/onboarding`), then checks the `/dispatch`-style route
   table — `/loads` itself isn't in `ROLE_ROUTES`, so this step just
   passes the (now-refreshed) session cookies through
   (`carrieros-web/proxy.ts:140-148`, `:228-240`).

2. **`app/(app)/layout.tsx` (shared authenticated shell)** — re-checks the
   session server-side (`createClient()` + `auth.getUser()`), and if there's
   no user, redirects to `/login`:
   ```ts
   // carrieros-web/app/(app)/layout.tsx:16-19
   const supabase = await createClient()
   const { data: { user } } = await supabase.auth.getUser()
   if (!user) redirect('/login')
   ```

3. **`app/(app)/loads/page.tsx` (the page itself)** — re-fetches the user,
   then builds an `ActorContext` from their *own* profile row:
   ```ts
   // carrieros-web/app/(app)/loads/page.tsx:29-34
   const supabase = await createClient()
   const { data: { user } } = await supabase.auth.getUser()
   if (!user) redirect('/login')
   const actor = await buildActorContext(supabase, user, crypto.randomUUID())
   if (!actor.ok) redirect('/onboarding')
   ```
   `buildActorContext()` reads `profiles.org_id` / `profiles.role` for
   `user.id` and returns `{userId, orgId, role, isPlatformOperator,
   correlationId}` (`carrieros-web/server/infrastructure/supabase/actor-context.ts:11-28`).
   Crucially, `orgId` and `role` come **only** from the caller's own DB row —
   never from a header, query param, or client-supplied value.

4. **`server/application/load-query-service.ts` (application layer)** —
   `LoadQueryService.list(actor, input)` checks the `invoice_actions`
   capability (to decide whether `rate` may be included) and delegates to
   the repository (`carrieros-web/server/application/load-query-service.ts:35-51`).

5. **`server/infrastructure/supabase/load-read-repository.ts` (adapter,
   application-layer org filter)** — builds the query using the caller's
   own RLS-scoped Supabase client, and *explicitly* filters by
   `actor.orgId` as defense in depth on top of RLS:
   ```ts
   // carrieros-web/server/infrastructure/supabase/load-read-repository.ts:43-47
   let query = (this.supabase as unknown as SupabaseClient)
     .from(isDriver ? 'loads_driver_view' : 'loads')
     .select(withRate ? `${BASE_COLUMNS}, rate` : BASE_COLUMNS)
     .eq('carrier_org_id', actor.orgId)
   ```

6. **Postgres RLS (the actual enforcement boundary)** — even though the
   query above already filters by `carrier_org_id`, the query executes
   under the caller's own authenticated Postgres role, so the `loads` table
   RLS policies apply independently: `dispatcher_loads_select` requires
   `carrier_org_id = my_org_id() AND my_role() = 'dispatcher'`
   (`supabase/schema/schema.sql:1897-1900`). If the application-layer filter
   were ever removed or had a bug, RLS alone would still prevent rows from
   another org being returned.

This two-filter pattern (`.eq('carrier_org_id', actor.orgId)` in code, `my_org_id()`
in the RLS policy) is deliberate and repeated across every repository — ADR
0003 §6 explains why RLS is kept even once application code owns the
"official" filter: it is the backstop for a bug in the filter, a future
direct-`.from()` regression, or a caller hitting PostgREST directly with
their own token.

## 5. Conventions and gotchas

- **RLS policies are a real security boundary — do not work around them in
  test setup.** Because RLS is enforced on any query made with the anon-key
  client (which is what `createClient()` returns and what almost every
  Server Component/route uses), test fixtures that need to write
  cross-tenant data, seed another org's rows, or otherwise bypass a policy
  must use `createAdminClient()` (service-role) deliberately and knowingly —
  never by "logging in as" a user who happens to satisfy the policy by
  accident. Conversely, if a QA test *expects* tenant isolation (e.g. "user
  A cannot see org B's loads"), assert it via the same RLS-scoped path the
  app itself uses, not the admin client — the admin client bypasses RLS
  entirely and will hide a real regression.
- **`is_active = false` fully revokes access.** Both `my_org_id()` and
  `my_role()` return `NULL` for a deactivated profile, which denies every
  policy built on them (`supabase/schema/schema.sql:1613-1615`). A
  deactivated user still has a valid Supabase session but effectively no
  data access — useful for QA scenarios around offboarding, but also a trap
  if a test deactivates a profile mid-test and expects normal 403s rather
  than empty-result RLS denials.
- **Service-role clients (`createAdminClient()`) bypass RLS entirely.** They
  exist for exactly two purposes in this codebase: the SuperAdmin
  cross-tenant routes (`lib/admin-auth.ts`) and the `lib/auth-admin/`
  provider (privileged `auth.admin.*` operations like inviting/deleting
  users or generating magic links, which Supabase does not expose to a
  regular session). Any other use of `createAdminClient()` should be treated
  as suspicious — the modernization baseline audit
  (`architecture/carrieros-modernization-baseline.md`) flagged an
  unauthenticated service-role entry point (`app/api/intake/email/route.ts`,
  finding S5, still **Open**) and a re-export of `createAdminClient` from
  `lib/api-auth.ts` that widens the service-role import surface for no
  benefit (finding S7, also **Open**) as exactly this kind of risk.
- **RLS-without-policy and missing-grant bugs have happened before.** The
  baseline audit notes the project has already hit "a table shipped with RLS
  enabled but no policy" and a related ordering bug with `org_sequences`
  (`supabase/schema/schema.sql:987-996` references both directly). When
  adding a new tenant table, RLS must be enabled **and** given an explicit
  policy in the same migration — an RLS-enabled table with zero policies
  denies all access by default (fails safe), but a table left without RLS
  enabled at all fails open.
- **`check_ifta_completeness(p_load_id)` performs no tenant check** — flagged
  as finding S4 in the baseline audit, still **Open** at time of writing.
  Any test or feature touching IFTA completeness should not assume this
  function is tenant-scoped.
- **The public API's `role: 'finance'` reuse is intentional, not
  accidental** — see §3(e). Don't "fix" it by inventing a new role; it's a
  least-privilege choice that happens to already have exactly the right
  capability set.
- **`/api/**` routes are excluded from `proxy.ts`'s cookie-based auth gate**
  (`carrieros-web/proxy.ts:91-96`) because they authenticate themselves via
  `lib/api-auth.ts`, which also accepts mobile's bearer token. Don't expect
  `proxy.ts` to protect a new `/api/*` route — it won't; the route handler
  itself must call `getAuthedContext()` (or `requireAdminRole()` /
  `getPublicApiContext()` as appropriate).
- **ADR 0003's "lint + RLS backstop, not a hard lockdown"** — a determined
  user can still call PostgREST directly with their own token and reach only
  their own tenant's rows (RLS still applies); this is called out as an
  accepted, revisit-later posture rather than a gap to be "fixed" casually.

## 6. See also

- `architecture/walkthrough/03-api-and-public-api.md` — the API surface this
  auth model protects (`/api/v1/**`, `/api/public/v1/**`).
- `architecture/adr/0002-layered-server-architecture.md` — the
  `app/api → server/application → server/ports → server/infrastructure`
  stack that `ActorContext` and the repositories in §4 belong to.
- `architecture/adr/0003-api-only-data-access.md` — why RLS is kept as
  defense in depth even once all reads/writes route through one shared API
  layer (§6 of that ADR), and the migration roadmap for the ~19 web
  components that still write directly to Supabase.
- `architecture/carrieros-modernization-baseline.md` — the full auth/RLS
  audit (open findings S4–S7, RLS coverage stats: 40/40 tables enabled, 95
  policies, 0 tables with FORCE RLS).
- `supabase/schema/schema.sql` SECTION 8 — every RLS policy in the system,
  and SECTION 3c — the ShipmentX platform-admin schema and reasoning.
