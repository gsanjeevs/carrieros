# 03 — The API layer: internal `/api/v1`, legacy routes, and the public developer API

This is the transport layer: the code that turns an HTTP request into a call
into `server/application` and a domain result back into an HTTP response. It
does **not** cover what happens inside `server/application`/`server/domain` —
see `02-domain-application-layer.md` for that.

## 1. Purpose

Per `architecture/adr/0002-layered-server-architecture.md`, the stack is:

```
app/api/v1/**        transport   parse, authenticate, authorize, validate,
                                 delegate, map result → HTTP
server/application/  use cases   orchestration; depends on domain + ports
server/domain/       model       entities, value objects, state machines; PURE
server/ports/        interfaces  repositories, clock, ids, outbox, storage
server/infrastructure/ adapters  Supabase/Postgres implementations
```

`app/api/v1/**` is the only layer allowed to touch HTTP concerns (headers,
status codes, `NextRequest`/`NextResponse`). It has one job per route: parse
the request, authenticate the caller, validate input against a schema,
delegate to an application service, and map the `Result` it gets back to an
HTTP response. Business logic does not belong here — a v1 route that calls
`.from()`/`.rpc()` directly is a hard build failure (see §5).

There are **three** surfaces in this codebase, and they exist for different
reasons:

- **`/api/v1/**`** — the internal, versioned API. Per
  `architecture/adr/0003-api-only-data-access.md`, this is meant to become the
  *only* way any frontend (web client components, web Server Components via
  in-process calls, and `carrieros-mobile`) touches data. One use case, one
  implementation, reached over HTTP by mobile/web-client code and in-process
  by web Server Components (`server/composition.ts`).
- **Legacy, unversioned routes** (`app/api/loads/*`, `app/api/admin/*`,
  `app/api/team/*`, etc.) — routes that predate the layered stack. They call
  `lib/queries/*` and Supabase directly from the route handler (see §3). ADR
  0003 tracks their replacement as debt, not as a second permanent idiom;
  `architecture/inventory/remaining-direct-access.json` and
  `architecture/inventory/web-supabase-usage.md` are the generated inventory
  of what's left.
- **`app/api/public/v1/**`** — a *separate*, read-only, OAuth2
  client-credentials-authenticated surface for third-party integrations. It is
  not "v1 of the internal API published externally" — it has its own auth
  model (`lib/public-api-auth.ts`, no Supabase session ever exists for these
  callers), its own error envelope (RFC 6749-flavored), its own rate limiter,
  and its own schemas (`server/contract/public-schemas.ts`). It reuses the
  *same application services* as `/api/v1` (e.g. `LoadQueryService`) so that
  org scoping, driver restrictions, and rate-column visibility are decided in
  exactly one place regardless of which door a caller came through — but it
  is a distinct trust boundary, versioned and evolved independently of the
  internal API.

## 2. File structure

### `carrieros-web/app/api/v1/` — internal versioned API (65 `route.ts` files)

```
app/api/v1/
  loads/
    route.ts                              GET list / POST create
    [id]/route.ts                         GET one load
    [id]/milestones/route.ts              POST status+timeline+audit+outbox (atomic)
    [id]/messages/route.ts, .../read/     load chat
    [id]/documents/route.ts, document-uploads/  signed-URL uploads
    [id]/fuel-stops/, .../[fuel_stop_id]/receipt/
    [id]/ifta-crossings/, .../manual/     IFTA GPS + manual override
    [id]/dvir-inspections/route.ts
    [id]/expenses/, problem-reports/, loadboard-postings/, location/
    extract-image/, extract-text/         AI extraction
  invoices/
    route.ts, [id]/route.ts, [id]/send/route.ts, [id]/mark-paid/route.ts
  dvir-inspections/  (+ [id]/attachments, attachment-uploads)
  vehicles/  (+ [id]/route.ts, [id]/service-logs/)
  drivers/, customers/ (+[id]), driver-messages/ (+[id]/translate)
  webhooks/  (+ [webhook_id]/route.ts, rotate-secret/, deliveries/)
  oauth-clients/  (+ [client_id]/route.ts)  -- issuing credentials FOR the public API, not consuming it
  me/  (route.ts, preferences/, push-token/, avatar/, avatar/uploads/, driver-profile/, entitlements/)
  billing/  (route.ts, change-tier/, payment-method/)
  reports/ifta-quarterly/  (+ export/)
  events/route.ts                         SSE change-feed (ADR 0003 §4)
  dashboard/, exceptions/, messages/, settlements/, onboarding/
  admin/error-log/, maintenance-reminders/, loadboard-integrations/, telematics-integrations/, org-documents/
```

### Legacy, unversioned routes (69 `route.ts` files, excluding `v1/` and `public/`)

```
app/api/
  loads/            route.ts, [id]/route.ts, [id]/orders/, [id]/send-documents/,
                     [id]/customer-exceptions/, export/
  invoices/[id]/    factor/, send/, track/
  drivers/          route.ts, invite/
  customers/        route.ts, bulk-import/, [org_id]/contacts/ (+[contact_id]/invite,revoke)
  vehicles/         route.ts
  settlements/      run/, [id]/send-ach/
  team/             route.ts, [id]/route.ts, invite/
  admin/            ai-config/, analytics/, audit/, billing/, flags/(override), onboarding/,
                     orgs/ (+ [org_id]/ tier, trial, impersonate, grace-period, notes,
                     feature-overrides, support-sessions, users/[user_id]), pipeline/, roles/(regenerate)
  support/          org-queue/, tickets/ (+ [id]/route.ts, reply/, escalate/)
  billing/          add-payment-method/, change-tier/
  driver-messages/  route.ts, [id]/translate/
  webhooks/telematics/motive/[org_id]/
  onboarding/, settings/branding/, extract-load/, extract-load-image/
  intake/email/, demo/gps/, dev/samsara-mock/..., cron/send-reminders/, cron/telematics/samsara-poll/
  version/
```

Roughly one legacy route exists for every v1 route today (69 vs 65) — the
migration is closer to half than to done, which lines up with ADR 0003's
"foundation + loads pilot implemented; migration in progress" status and the
counts in `architecture/inventory/remaining-direct-access.json`.

### `carrieros-web/app/api/public/v1/` — public developer API (10 `route.ts` files)

```
app/api/public/v1/
  oauth/token/route.ts        POST — client_credentials grant, issues a signed JWT
  openapi.json/route.ts       GET  — published contract for external developers
  loads/route.ts               GET list
  loads/[id]/route.ts          GET one
  invoices/route.ts            GET list
  invoices/[id]/route.ts       GET one
  vehicles/route.ts            GET list
  drivers/route.ts             GET list
  exceptions/route.ts          GET list
  financial-events/route.ts    GET list
```

Every route under `public/v1/` except `oauth/token` and `openapi.json` is a
`GET` — this surface is read-only by design (`scope: 'read'` is baked into
the token itself; see §5).

## 3. Key files

### a. Internal v1 route — parse → auth → validate → delegate → map

`carrieros-web/app/api/v1/loads/route.ts:15-46` (the `GET` handler):

```ts
export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = request.nextUrl.searchParams
  const parsed = ListLoadsQuerySchema.safeParse({
    status_group: params.get('status_group') ?? undefined,
    limit: params.has('limit') ? Number(params.get('limit')) : undefined,
  })
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid query', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createLoadQueryService(authed.supabase).list(actor.value, {
    statusGroups: parsed.data.status_group?.split(',') as LoadStatusGroup[] | undefined,
    limit: parsed.data.limit,
  })
  if (!result.ok) {
    logError({ route: 'api/v1/loads GET', requestId, userId: authed.user.id }, result.error.detail)
    return domainErrorResponse(result.error)
  }

  // Parse our own output against the contract: the schema is the promise, and
  // this makes a violation (e.g. a stray `rate`) fail loudly instead of leaking.
  const body = ListLoadsResponseSchema.parse({
    loads: result.value.loads,
    can_see_rate: result.value.canSeeRate,
  })
  return NextResponse.json(body)
}
```

This is the canonical shape every v1 route follows: **authenticate**
(`getAuthedContext`) → **validate** (`ListLoadsQuerySchema.safeParse`) →
**build actor / authorize** (`buildActorContext`, which resolves org and role)
→ **delegate** (`createLoadQueryService(...).list(...)`) → **map** (parse the
service's output against the response schema, then `NextResponse.json`). Note
the route never touches `.from()` or `.rpc()` — that's enforced (§5).

### b. Legacy route — for contrast

`carrieros-web/app/api/loads/route.ts:34-101` (the `POST` handler) does the
same job — auth, authorize, validate, persist, respond — but inline, with the
Supabase call, capability check, and hand-rolled field coercion all living in
the route handler itself:

```ts
export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization found for this user', 400)
  if (!roleHasCapability(profile.role, 'loads_manage')) return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return apiError('VALIDATION_ERROR', 'Invalid request body', 400) }
  // ... ~20 lines of manual text()/number() field coercion (lines 56-82) ...

  const load_number = await generateLoadNumber(supabase, profile.org_id)
  const { data: load, error } = await createLoad(supabase, { carrier_org_id: profile.org_id, load_number, status: 'draft', ...values })
  if (error) { logError(...); return apiError('SERVER_ERROR', error.message, 500) }
  return NextResponse.json({ load_number: load.load_number }, { status: 201 })
}
```

There's no zod schema, no `server/application` service, no domain `Result` —
`createLoad` (`lib/queries/loads.ts`) is a thin Supabase wrapper called
directly from transport. This is exactly the pattern ADR 0002/0003 are
migrating away from: the `loads_manage` capability check, the field
validation, and the insert are three untestable, un-reusable pieces of logic
glued together in a route handler instead of one application service used by
every caller.

### c. Public API route — OAuth2 client-credentials token issuance

`carrieros-web/app/api/public/v1/oauth/token/route.ts:14-54`:

```ts
export async function POST(request: NextRequest) {
  let json: unknown
  try { json = await request.json() } catch { return publicApiError('invalid_request', 'Body must be JSON', 400) }

  const parsed = TokenRequestBodySchema.safeParse(json)
  if (!parsed.success) return publicApiError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid request body', 400)

  const result = await createPublicApiTokenService().issueToken({
    clientId: parsed.data.client_id,
    clientSecret: parsed.data.client_secret,
  })
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/public/v1/oauth/token POST', requestId: request.headers.get('x-request-id') }, result.error.detail)
    }
    return domainErrorToPublicApiResponse(result.error)
  }

  // Signing (not the application service) is the one place the raw JWT secret is touched, matching
  // lib/api-auth.ts owning session-token concerns rather than server/application.
  let accessToken: string
  try {
    accessToken = signPublicApiToken(result.value)
  } catch {
    logError({ route: 'api/public/v1/oauth/token POST', requestId: request.headers.get('x-request-id') }, 'PUBLIC_API_JWT_SECRET is not configured')
    return publicApiError('server_error', 'Public API is not configured', 500)
  }

  const body = TokenResponseSchema.parse({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: PUBLIC_API_TOKEN_TTL_SECONDS,
  })
  return NextResponse.json(body)
}
```

Credential verification is delegated to `PublicApiTokenService`
(`server/application/public-api-token-service.ts`) exactly like an internal
route delegates to an application service — the route's own job is limited
to parsing the grant request and signing the resulting JWT.

### d. Public API data route — reusing the internal application service

`carrieros-web/app/api/public/v1/loads/route.ts:22-45`:

```ts
export async function GET(request: NextRequest) {
  const claims = await getPublicApiContext(request)
  if (claims instanceof NextResponse) return claims

  const limited = await createPublicApiRateLimiter().checkAndIncrement(claims.clientId)
  if (!limited.ok) return publicApiError('server_error', limited.error.detail, 500)
  if (!limited.value.allowed) return rateLimitedResponse(limited.value.retryAfterSeconds)

  const params = request.nextUrl.searchParams
  const parsedQuery = PublicListLoadsQuerySchema.safeParse({
    limit: params.has('limit') ? Number(params.get('limit')) : undefined,
  })
  if (!parsedQuery.success) return publicApiError('invalid_request', parsedQuery.error.issues[0]?.message ?? 'Invalid query', 400)

  const actor = buildPublicApiActor(claims)
  const result = await createLoadQueryService(createAdminClient()).list(actor, { limit: parsedQuery.data.limit })
  if (!result.ok) {
    logError({ route: 'api/public/v1/loads GET', orgId: actor.orgId }, result.error.detail)
    return domainErrorToPublicApiResponse(result.error)
  }

  const body = ListLoadsResponseSchema.parse({ loads: result.value.loads, can_see_rate: result.value.canSeeRate })
  return NextResponse.json(body)
}
```

The `LoadQueryService` call (`createLoadQueryService(...).list(...)`) is
**the same class** the internal `/api/v1/loads` route calls. The only
differences are the Supabase client (`createAdminClient()`, service-role,
since there's no session) and the actor (`buildPublicApiActor`, built from
verified JWT claims instead of a Supabase user) — the file header at
`carrieros-web/app/api/public/v1/loads/route.ts:8-13` explains why this is
safe: `LoadReadRepository` always scopes by `actor.orgId` itself, and that
`orgId` comes only from the verified JWT, never from the request.

## 4. How to trace a request end-to-end

### Internal API: `GET /api/v1/loads`

1. **HTTP request** — mobile or a web client component calls
   `GET /api/v1/loads?status_group=active` with either a cookie session (web)
   or `Authorization: Bearer <token>` (mobile).
2. **Route handler** — `carrieros-web/app/api/v1/loads/route.ts:15` (`GET`).
3. **Authenticate** — `getAuthedContext(request)`
   (`carrieros-web/lib/api-auth.ts`) resolves the caller from either the
   bearer token or the cookie session and returns `{ supabase, user }` or a
   `401` `NextResponse`.
4. **Validate** — `ListLoadsQuerySchema.safeParse(...)` (zod, from
   `server/contract/schemas.ts`) checks `status_group`/`limit`; a bad query
   short-circuits with `VALIDATION_ERROR` / 400.
5. **Authorize / build actor** — `buildActorContext(authed.supabase,
   authed.user, requestId)` (`server/infrastructure/supabase/actor-context.ts`)
   resolves the caller's org and role into an `ActorContext`.
6. **Delegate** — `createLoadQueryService(authed.supabase).list(actor.value,
   {...})` (`server/composition.ts` wires the concrete
   `LoadReadRepository`). This runs entirely in `server/application` +
   `server/domain` + `server/ports`/`infrastructure` — none of that is this
   route's concern; see `02-domain-application-layer.md`.
7. **Map result → HTTP response** — on failure, `domainErrorResponse(...)`
   maps the domain `Result`'s error code to a status; on success, the output
   is re-validated against `ListLoadsResponseSchema` and returned as JSON via
   `NextResponse.json(body)`.

The same `LoadQueryService.list()` call also runs **in-process**, with no
HTTP hop, from the web loads list page (`app/(app)/loads/page.tsx`, via
`server/composition.ts`) — per ADR 0003, "one implementation, two doors."

### Public API: `GET /api/public/v1/loads`

1. **Token acquisition** — the external client first calls `POST
   /api/public/v1/oauth/token` with `client_id`/`client_secret` (issued from
   the internal `/api/v1/oauth-clients` management UI/route) and a
   `grant_type: client_credentials` body; gets back a short-lived
   (3600s) signed JWT.
2. **Request** — subsequent calls send `Authorization: Bearer <jwt>` to e.g.
   `GET /api/public/v1/loads`.
3. **Route** — `carrieros-web/app/api/public/v1/loads/route.ts:22` verifies
   the JWT (`getPublicApiContext`), checks the per-client rate limit
   (`createPublicApiRateLimiter().checkAndIncrement`), validates the query,
   builds a synthetic `ActorContext` (`buildPublicApiActor`), and calls the
   *same* `LoadQueryService.list()` as the internal route — just against an
   admin (service-role) Supabase client instead of a session-scoped one.
4. **Response** — RFC-6749-flavored error envelope on failure
   (`domainErrorToPublicApiResponse`), or the same `ListLoadsResponseSchema`
   shape as the internal API on success.

**Real external consumer:** the `carrieros-mcp` project (a sibling repo,
`/Users/sanjeevgautam/code/carrieros-mcp`) is an MCP server that wraps this
exact public API for AI-assistant tool use. Its client
(`carrieros-mcp/src/carrieros-client.ts`) implements precisely this flow —
`getToken()` POSTs to `/api/public/v1/oauth/token`, caches the access token
in memory, and refreshes it 60 seconds before `expires_in` elapses so a
long-running MCP session never hands a stale token to a tool call mid-request
(`carrieros-mcp/src/carrieros-client.ts:40-61`). It's a working example of
what "third-party integration" means for this API in practice — worth
pointing QA at when testing the public surface, since it exercises the token
refresh path realistically instead of just the happy-path single call.

## 5. Conventions and gotchas

- **`v1-route-delegation` is a live, enforced rule.** Verified in
  `carrieros-web/scripts/check-architecture.mjs:123-129`: any file under
  `app/api/v1` matching `/\.from\(['"`]|\.rpc\(['"`]/` is a hard error —
  "app/api/v1 route handlers must delegate to an application service — no
  direct .from()/.rpc() table or RPC access." This runs as part of the
  architecture check gate; it is a day-one hard error, not a ratcheted
  warning (ADR 0002's rationale: `server/` was new, so there was nothing to
  grandfather).
- **`api-only-frontend` is a ratchet, not (yet) a blanket rule** — legacy
  direct-Supabase call sites outside `app/api/v1` are counted as debt
  (`check-architecture.mjs:281-345`, printed as "API-only migration (ADR
  0003) — remaining direct DB call sites"), but only files explicitly added
  to the `API_ONLY` set fail hard on a *new* direct call. Don't assume a
  legacy route or component is "allowed" just because the check passes —
  check whether it's in `API_ONLY` or just not migrated yet.
- **Two auth patterns, do not mix them up.** Internal routes use
  `lib/api-auth.ts`'s `getAuthedContext()`, which accepts either a cookie
  session (web) or `Authorization: Bearer <supabase-access-token>` (mobile) —
  see the header comment at `carrieros-web/lib/api-auth.ts:1-19`. Public API
  routes use `lib/public-api-auth.ts`'s `getPublicApiContext()`, which
  accepts *only* a bearer JWT signed by this app itself (`PUBLIC_API_JWT_SECRET`,
  HS256, algorithm pinned explicitly against alg-confusion attacks — see
  `carrieros-web/lib/public-api-auth.ts:67-84`). These are deliberately not
  unified — `public-api-auth.ts`'s header comment explains it's "deliberately
  NOT lib/api-auth.ts and NOT a wrapper around getAuthedContext()" because
  that function assumes a Supabase session/user token, which does not exist
  for an OAuth client-credentials caller.
- **The public API token asserts an org, not a user, and never re-checks
  entitlements after issuance.** Per `carrieros-web/lib/public-api-auth.ts:11-19`,
  tier/entitlement is checked once at `/oauth/token` issuance
  (`PublicApiTokenService`) but not again for the life of the 1-hour token —
  an accepted v1 scope decision, not an oversight.
- **The public API token's actor role is `'finance'` — a deliberate,
  documented least-privilege choice**, not a placeholder. Per
  `carrieros-web/lib/public-api-auth.ts:90-97` (`buildPublicApiActor`),
  `finance` is the one existing role whose capabilities
  (`loads_view`, `invoice_actions`, `rate_visibility`) match exactly what a
  read-only external integration needs, with none of `owner`'s
  administrative capabilities (`team_manage`, `drivers_manage`,
  `vehicles_manage`, ...). `isPlatformOperator` is hardcoded `false` — a
  public API caller is always tenant-scoped, never platform staff, no matter
  which org issued the token. Scope on the token itself is typed as the
  literal `'read'` (`PublicApiTokenClaims.scope`), matching the fact that
  every public route except `/oauth/token` is a `GET`.
- **Error shapes differ by surface, and that's intentional.** Internal routes
  return `{ error_code, error, meta? }` (`apiError()` in `lib/api-auth.ts`).
  Public API routes return `{ error, error_description }`
  (`publicApiError()` in `lib/public-api-auth.ts`), loosely following RFC
  6749 §5.2's OAuth error vocabulary, on *every* route in that surface
  (including data routes, not just `/oauth/token`) — "an external developer
  parses one error format" per the header comment at
  `carrieros-web/lib/public-api-auth.ts:114-120`.
- **Public API errors never reveal *why* a token was rejected.** Expired,
  bad-signature, and malformed tokens all collapse to the same
  `invalid_token` / 401 response (`carrieros-web/lib/public-api-auth.ts:79-83`)
  — don't "fix" this to be more specific; it's a deliberate anti-enumeration
  choice.
- **Idempotency keys are required on some v1 writes.** e.g. `POST
  /api/v1/loads` requires an `Idempotency-Key` header
  (`IdempotencyKeyHeaderSchema`, 8–128 chars) — see
  `carrieros-web/app/api/v1/loads/route.ts:52-53`. Not universal; check the
  specific route's schema rather than assuming.
- **Schema-first contracts.** Request/response shapes for `/api/v1` live in
  `server/contract/schemas.ts`; the public API has its own,
  `server/contract/public-schemas.ts`. `npm run gen:api` (in
  `carrieros-web`) generates the OpenAPI doc, TypeScript types, and a typed
  client for both `carrieros-web` and the mobile app; `npm run check:api`
  runs in CI so a client left behind fails the build (ADR 0003 §3). The
  public API's own contract is served live at `GET
  /api/public/v1/openapi.json`.
- **Versioning is directory-based, not header-based**, for both surfaces —
  a `v2` would be a new `app/api/v2/` (or `app/api/public/v2/`) directory,
  not content negotiation.

## 6. See also

- `architecture/adr/0002-layered-server-architecture.md` — why the layered
  stack exists and what enforces its boundaries.
- `architecture/adr/0003-api-only-data-access.md` — why the API is meant to
  be the only frontend data-access path, and the migration status/roadmap.
- `architecture/walkthrough/02-domain-application-layer.md` — what happens
  once a v1 route delegates (`server/application`, `server/domain`,
  `server/ports`).
- `architecture/walkthrough/04-auth-and-authorization.md` — session
  resolution, role/capability model, and RLS in more depth.
- `architecture/inventory/remaining-direct-access.json` and
  `architecture/inventory/web-supabase-usage.md` — the generated inventory of
  legacy direct-access debt referenced in §1 and §5.
