# CarrierOS — Data/API Architecture Principles

_Drafted 2026-07-22, prompted by a direct question: have we ensured data-model changes (adding or
changing a column) don't ripple into every API/business-logic call site? Two research passes
(quantifying actual coupling, cataloguing what's already solid) confirmed the concern is real, with
concrete evidence cited throughout below — not abstract advice. This document is meant to be durable:
CarrierOS is still laying foundational blocks, and the goal is confidence, not throwaway prototype code._

---

## 0. Why `tsc --noEmit` passing doesn't prove this is safe

`organizations.type`, `profiles.role`, `loads.status`, and every other "enum-like" column in this
schema are `TEXT + CHECK`, not Postgres native enum types (a deliberate, documented choice — see
`supabase/schema/README.md`). Supabase's type generator maps a `TEXT` column to plain `string` in
TypeScript. That means there is **no compiler-level exhaustiveness check** protecting any code that
branches on one of these values — adding a new CHECK value doesn't change the generated type at all,
so `tsc` can pass cleanly while real code silently mishandles the new value. This was proven directly
this session: adding `sx_owner`/`sx_finance`/`sx_support` to `profiles.role` and `'platform'` to
`organizations.type` typechecked fine, but `dashboard/page.tsx`'s role-based view router has no
fallback case, so those new roles render a blank dashboard body with no error anywhere.

Everything below exists to close this gap — with tooling and structure, not just discipline.

---

## 1. Preserve — what's already solid (do not erode these while fixing the gaps below)

These patterns already do real architectural work and are the model to extend, not replace:

- **`SECURITY DEFINER` SQL functions as the centralization seam.** `my_org_id()`, `my_role()`,
  `has_feature()`, `get_my_entitlements()`, `get_exceptions()`, `get_customer_health_score()`,
  `check_ifta_completeness()`, `next_entity_val()`, and others already collapse logic that would
  otherwise be re-derived per call-site into one named, RLS-callable function. This is the single
  strongest existing pattern in the codebase — see Rule D below for extending it further.
- **R3b** (`docs/decisions.md`) already gives a clean test for "does this write need a Next.js API
  route (needs a service-role secret) or can it be a plain RPC/direct table call shared by web and
  mobile?" Rule B below is a sub-rule *within* R3b's second branch, not a replacement for it.
- **The generated-types workflow** (`./scripts/regen-types.sh`, never hand-edited, both apps
  regenerated together) is a real, mechanically enforced single source of truth for column *shape* —
  it just can't (structurally can't, given TEXT+CHECK) catch enum-value exhaustiveness, which is why
  Rule A exists.
- **`carrier_org_id` as the universal FK naming convention**, `next_entity_val()`'s atomic,
  race-free entity numbering, the deactivate-never-delete convention centralized inside
  `my_org_id()`/`my_role()`'s `is_active` filter (one change, cascades everywhere), the storage
  bucket path-as-tenant-isolation convention (`{carrier_org_id}/...`, enforced by policy), and the
  `{error_code, error}` API error contract (never render raw English error text to an end user) are
  all genuinely solid and should keep being followed exactly as documented in `docs/decisions.md`.

---

## 2. The gap — quantified, not hypothetical

- **No query encapsulation exists anywhere.** `profiles` is queried directly (`.from('profiles')`)
  from 51 separate files across both apps; `loads` from 23; `drivers` 18; `invoices` 13; `vehicles` 12;
  `organizations` 11. There is no `lib/queries/`, `lib/repositories/`, or equivalent in either app —
  every call site hand-writes its own column list and joins.
- **`loads.status`'s color/label mapping is independently hand-copied in at least 8 places**:
  `app/(app)/loads/page.tsx`, `app/(app)/loads/[load_number]/page.tsx`, `app/(app)/dashboard/OwnerView.tsx`,
  `app/(app)/dashboard/MyLoadCard.tsx`, `app/track/[token]/page.tsx`, three entity-detail pages
  (customers/drivers/vehicles), plus mobile's `theme.ts`. Three of the web copies have comments
  admitting the duplication is deliberate policy. The copies have already **drifted** — delivered/paid
  color hex differs between the loads list and the load detail page.
- **A live, real functional bug, not a style issue**: `BILLING_ROLES` is `['owner','solo','finance']`
  in five files (`customers/[customer_number]/page.tsx`, `invoices/actions.ts`, `invoices/page.tsx`,
  `invoices/[invoice_number]/page.tsx`, `api/invoices/[id]/factor/route.ts`) but `['owner','solo']`
  (no finance) in two billing routes (`api/billing/add-payment-method/route.ts`,
  `api/billing/change-tier/route.ts`) — same concept, silently inconsistent. At least 20 other
  `_ROLES` arrays (`VIEW_ROLES`, `MANAGE_ROLES`, `ADMIN_ROLES`, `DISPATCH_ROLES`, etc.) are similarly
  redeclared per-file with no shared source.
- **Confirmed dashboard bug** (found this session, described in §0): `dashboard/page.tsx` and
  `proxy.ts` branch over `profile.role` for *rendering* with no exhaustive/fallback handling. Note the
  distinction: *allow-list gating* (`if (!ROLES.includes(profile.role)) deny`) already fails closed
  safely by construction — the bug is specifically in *positive render branching* with no default case.
  Mobile compounds this by force-casting `role` to a `Role` type (`as Role`) with zero runtime
  validation.
- **Inconsistent API response shaping.** Some GET routes (`api/vehicles`, `api/drivers`,
  `api/customers`) pass raw Supabase query results straight to `NextResponse.json()`, including
  internal Postgrest embed/join key names (e.g. `organizations!customer_details_org_id_fkey`) as part
  of the wire contract. Others (`api/admin/orgs/[org_id]`, `api/loads/[id]` PATCH, `api/team/[id]`)
  hand-construct a minimal, explicit response object. There is no consistent boundary insulating any
  consumer — mobile today, a future Phase 9 public API — from a table's actual column/relationship
  names.

---

## 3. The rules

### Rule A — Shared enum/status modules with exhaustive handling

For every `TEXT + CHECK` column that's *rendered* (not just used in allow-list gating), define one
shared TypeScript module per app exporting: the literal union type, an ordered list of valid values,
and any derived color/label/icon maps. Every render site consumes that module and uses an **exhaustive
`switch`** with a `never`-typed default branch — so a new database value with no corresponding code
update is a **TypeScript compile error**, not a silently blank/wrong render.

```ts
// example shape
export type LoadStatus = 'draft' | 'scheduled' | 'dispatched' | 'picked_up' |
  'in_transit' | 'delivered' | 'invoiced' | 'paid' | 'cancelled'

export function loadStatusColor(status: LoadStatus): string {
  switch (status) {
    case 'draft': return '...'
    // ...every case...
    default:
      // TypeScript errors here at compile time if a case is missing
      const _exhaustive: never = status
      return _exhaustive
  }
}
```

Retrofit targets, in priority order: `loads.status` (most duplicated, already drifted),
`profiles.role` (render sites only — allow-list gating sites are already safe and don't need this),
`organizations.type`.

**Not yet in scope**: literally sharing one module between `carrieros-web` and `carrieros-mobile` (they
have separate TS setups, no shared package today) — mirror the module in both apps for now, with a
comment cross-referencing the other copy, same treatment as the existing i18n-syntax-divergence note
in `docs/decisions.md` (T10).

**Enforcement (2026-09-21)**: `check-architecture.mjs`'s `rule-a-status-color-duplication` check flags a
hand-written status-color map (a `<status literal>: '<tailwind-or-hex-color>'` line, scoped to
`loads.status`'s vocabulary) outside `lib/domain` (web) or `constants/theme.ts` (mobile). Verified against
the tree before being added: it found one real hit, `app/track/[token]/page.tsx`'s `STATUS_COLOR` map —
deliberately not importing the authenticated pages' module per that file's own header comment (a public,
unauthenticated tracking page that must keep working even if the internal module changes), but still the
exact duplication shape this rule exists to prevent, and not mentioned as an exception anywhere in this
doc before now. Kept `warn`, not the hard gate a zero-violations run would otherwise justify (same
precedent as Rule G below).

### Rule B — Thin per-entity query modules for hot tables, not an ORM

`lib/queries/<entity>.ts` (e.g. `lib/queries/profiles.ts`, `lib/queries/loads.ts`) exporting named
functions for the column lists/joins that are *actually reused* today — not a full repository/ORM
layer, and not a mandate to migrate all 50+ existing call sites at once.

```ts
// lib/queries/profiles.ts
export async function getProfileForUser(supabase: SupabaseClient, userId: string) {
  return supabase.from('profiles').select('id, org_id, role, is_active').eq('id', userId).single()
}
```

**Adoption is incremental**: new code calls the shared function; existing call sites migrate
opportunistically when touched for other reasons. This sits *inside* R3b's "plain RLS CRUD or atomic
business rule" branch — it doesn't change whether something is a route or an RPC, it stops each call
site from hand-retyping the same query, so a column rename/addition is fixed in one function instead
of being grepped across dozens of files.

### Rule C — Explicit response DTOs at the API boundary

No `NextResponse.json(rawSupabaseRow)`. Every API route response is an explicitly typed/constructed
object, even when it's a 1:1 field mapping today. This is what actually insulates external consumers
(mobile today, a future Phase 9 public API) from a table's column names or Postgrest embed-relationship
internals — if a column is renamed or a join's shape changes, only the DTO-construction line changes,
not every consumer's parsing code.

```ts
// Not this:
return NextResponse.json(data)  // raw row(s), internal shape leaks to the wire

// This:
return NextResponse.json({
  id: vehicle.id,
  vehicle_number: vehicle.vehicle_number,
  nickname: vehicle.nickname,
  is_active: vehicle.is_active,
})
```

**Re-verified (2026-09-21), no new automated check.** Per the 2026-07-23 changelog entry below, an
automated lint for this rule was rejected: a false-positive risk was found (can't reliably distinguish "raw
Supabase row" from "already-reshaped variable" via regex without a real AST parse). That reasoning stands —
this pass did not revisit it. Instead, re-ran the same manual method the 2026-07-23 entry used, this time
across **all 87** `app/api/**/route.ts` files (not just the ones already known to be fixed), specifically
looking for routes added since then that might have reintroduced the pattern (the public developer API
work in progress at the time of this audit — `app/api/v1/oauth-clients`, `app/api/public/v1/*` — was an
obvious candidate). Result: **zero new violations.** The 9 routes fixed in 2026-07-23 remain fixed, and
every route added since (the `server/` layered-architecture routes under `app/api/v1/**` and
`app/api/public/v1/**`) already returns `NextResponse.json(SomeResponseSchema.parse({...}))` — an
explicitly-typed, Zod-validated DTO, which satisfies this rule by construction and is stronger than the
rule's own minimum bar. No fixes were needed as a result of this re-verification.

### Rule D — Prefer SQL functions over ad hoc TypeScript aggregation for cross-cutting/derived logic

Reinforces §1's strongest existing pattern. When a piece of logic needs to aggregate or derive a value
across multiple tables (a score, a completeness check, an entitlement), prefer a `SECURITY DEFINER` SQL
function over assembling it from N parallel queries in a route handler — one definition, callable from
anywhere, consistent with `has_feature()`/`get_exceptions()`/`get_customer_health_score()`.

**Self-critique, named explicitly rather than hidden**: the Phase 8 `/api/admin/orgs` health-score
computation (built this session) currently aggregates across `profiles`, `loads`, `drivers`,
`invoices`, `vehicles`, and `auth.users` via parallel TypeScript queries in the route handler, not a SQL
function — a direct violation of this rule as stated. Flagged as a concrete candidate to move into a
SQL function once the scoring formula stabilizes (it's still being tuned, per that route's own
comments), not fixed retroactively in this pass — but it should not be treated as a template for future
admin routes.

**Enforcement: deliberately none (confirmed 2026-09-21).** This is a design judgment call — "should this
specific aggregation live in SQL or TypeScript" depends on things a static check cannot see (is the
formula still being tuned, does it need transaction-local intermediate state, is it genuinely
cross-cutting or does it just touch two tables) — not a code shape a grep or lint can verify. No automated
check was written for it, matching Rule C's precedent above; left as documentation and case-by-case review. — Schema-change impact-analysis step

Formalized addition to `supabase/schema/README.md`'s existing verification checklist (schema replay +
`regen-types.sh` + `tsc --noEmit` are already documented there and remain necessary but insufficient for
this specific risk):

**Additive changes** (new nullable column, new table) remain low-risk — no extra step needed beyond the
existing checklist.

**Changes to a CHECK constraint's value set, or a column's meaning**, require one more step before
considering the change done: grep every branch site over that column across both apps (`grep -rn
"columnName" carrieros-web/app carrieros-web/lib carrieros-web/components carrieros-mobile/src`) and
confirm each one either has a safe fallback/exhaustive handling, or gets updated as part of the same
change. This is exactly the manual check that caught the `dashboard/page.tsx` bug this session —
writing it down here makes it a routine step instead of something caught by chance.

**Enforcement (2026-09-21)**: this is a workflow step, not a code-shape violation, so it's gated
differently from Rules A/G/H/I's grep checks — every migration file must carry a header comment (first
line `-- <filename>.sql`, at least 3 comment lines total before the first SQL statement) describing what
changed and why, matching the practice every migration in `supabase/migrations/` already follows (the
shortest existing header, `0003_revoke_anon_truncate_and_definer_execute.sql`, is 5 lines) — this
requires the already-common practice, it doesn't invent a new one. Checked in two places so it's caught
whether a migration is applied locally or only ever exercised in CI: `scripts/db/migrate.mjs`
(`validateMigrationHeader`, refuses to apply a migration missing one) and
`scripts/db/verify-migrations.mjs` (its own `check`, same rule, no DB required). Verified against all 26
existing migrations before being added — zero would have failed it. This does not, and cannot, verify
the *grep-every-branch-site* step itself was actually performed — that half of Rule E remains a judgment
call, same as Rule D.

### Rule F — Relationship to R3b

Rule B does not change R3b's route-vs-RPC test. R3b decides *where* a write lives (Next.js route vs.
RPC/direct table access); Rule B governs *how* a query is written once that decision is made — through
a named, shared query function for hot tables rather than an inline `.from()` call, regardless of
whether the caller is a route handler, a Server Component, or a mobile screen.

**Enforcement: deliberately none (2026-09-21).** Considered requiring every new `app/api/**/route.ts` to
carry a comment stating which R3b path it took and why, the same shape as Rule E's migration header. Ruled
out after checking actual adoption first: only 6 of the repo's 87 existing `route.ts` files even mention
R3b today, so requiring the comment everywhere would be inventing new ceremony nobody was already doing
(the opposite of Rule E's approach) rather than mechanizing an existing habit. More fundamentally, the
R3b test itself — "does this write need a Next.js route (service-role secret) or can it be a plain
RPC/direct table call" — is a judgment call about *why* a decision was made, not a shape a grep can verify;
a bot could require the comment's presence but not its correctness, which would make the gate theater
rather than enforcement. Same honest-non-gate posture as Rule C's regex-false-positive finding below and
Rule D's design-judgment nature — left as documentation only.

### Rule G — Provider-adapter boundary for cloud-specific services

Prompted by a direct question (2026-07-22): what would be required to leave Supabase for self-hosted/
AWS infrastructure, and — separately — could a future hyperscaler swap (AWS → GCP/Azure, on customer
demand) be made cheap if planned for now, early, before call-site count grows.

Two findings from that discussion, worth recording so they don't get re-litigated:

- **RLS itself is not Supabase-specific.** `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` are native
  Postgres, and work unchanged on AWS RDS, GCP Cloud SQL, and Azure Database for PostgreSQL — all three
  are real Postgres. The only genuinely Supabase-specific piece is `auth.uid()` (a convenience function
  reading a session variable Supabase's stack sets per request) — replaceable by a custom function
  reading an equivalent session variable your own backend sets after validating a JWT from any auth
  provider. This means a cloud/auth-provider swap does **not** require re-deriving the 96-policy
  authorization model as application code — that would be a large, security-risky rewrite this rule
  exists specifically to avoid needing.
- **For the pieces that genuinely differ per cloud** (auth provider, object storage), wrap them behind
  a small, call-site-facing interface *now*, while the number of call sites is still small — the
  switching cost only grows from here. Full "zero business-logic change" isn't achievable (each
  provider's admin/invite/MFA semantics differ at the edges) — the goal is minimizing the surface that
  ever needs to change, not eliminating it.

**Pattern**: one interface (`lib/<domain>/types.ts`), one Supabase implementation
(`lib/<domain>/supabase-*-provider.ts`) implementing it, one factory (`lib/<domain>/index.ts`) that
call sites import — `createXProvider(client)`. A future non-Supabase implementation is a new sibling
file behind the same interface; call sites never change. Deliberately lean: cover only operations
actually used today (Rule B's own "not a speculative full API" principle applies here too), not every
method a provider's SDK theoretically exposes.

**What got this treatment, and why (2026-07-22):**

- `lib/storage/` (`StorageProvider`: `uploadFile`, `getSignedUrl`, `remove`) — object storage
  semantics (signed URLs, path-scoped delete) are nearly identical across S3/GCS/Azure Blob/Supabase
  Storage, so this has very little leakage. `uploadFile`'s *mechanism* (a single SDK call today; a
  future cloud's implementation might do a signed-PUT-URL round trip internally) is hidden inside the
  provider — callers never needed to change to accommodate either shape.
- `lib/auth-admin/` (`AuthAdminProvider`: `listUsers`, `getUserById`, `inviteUserByEmail`,
  `deleteUser`, `generateMagicLink`) — the *privileged* auth surface (service-role user management),
  where providers genuinely differ most (Cognito's admin API shares little shape with Supabase's).
  Return values mirror supabase-js's own `{ data, error }` envelope on purpose — minimizes the diff at
  every one of the 9 call sites migrated onto it, and a future provider only needs to produce the same
  envelope, not push a new error-handling style onto every caller.

**What deliberately did NOT get a new interface, and why:**

- **Plain session resolution** (`lib/api-auth.ts`'s `getAuthedContext`) — already a single chokepoint
  before this pass, and auditing its ~46 call sites showed every one only ever reads `.user.id`, never
  any other Supabase-specific `User` field. It was already effectively decoupled in practice; adding a
  formal interface on top would have been ceremony with no behavior change. A future non-Supabase auth
  swap changes this one function's internals, same as before.
- **The database/query layer** — no `DatabaseProvider` abstraction. Postgres doesn't change across
  hyperscalers (RDS/Cloud SQL/Azure Database for PostgreSQL are all real Postgres), so there's nothing
  to abstract there; what varies is the *client library* talking to it (`supabase-js`/PostgREST vs. a
  direct `pg`/Drizzle client), and that's exactly what **Rule B**, once finished, already solves — a
  provider/hosting swap only touches `lib/queries/*.ts`, not a new adapter layer.

### Rule H — Cross-client business/gating logic goes in Postgres, single-sourced; never hand-duplicated TypeScript

Prompted by a direct architecture question (2026-09-19): "the backend and API must be common for both
mobile and web app — is this how it is set up?" An audit found the honest answer was *partial*:
Postgres (schema, RLS, SQL functions like `my_org_id()`, `has_feature()`) genuinely is shared and
identical for both clients, but there is no shared TypeScript layer and no unified API service —
`carrieros-mobile` bypasses `carrieros-web`'s `/api/**` for the large majority of its reads/writes
(direct `supabase.from()`/`supabase.rpc()` calls), and each app hand-writes its own copy of any rule
that isn't already a DB function or RLS policy. Two confirmed drift cases: role/navigation gating
(`proxy.ts`'s `ROLE_ROUTES` vs. mobile's `tab-sets.ts`, independently maintained) and `format-money.ts`
(duplicated with different capabilities in each app). `BILLING_ROLES` had already drifted once within
web alone (see Rule B section above) — mobile has no shared file at all, so the same class of bug would
recur independently there.

**The rule**: when a business rule or gating decision must be identical across both clients, it does
not get written as matching TypeScript in each app. It goes into Postgres — as an RLS policy or
`SECURITY DEFINER` function when it's a real security/data-access boundary, or as reference data in a
plain table when it's UI/navigation gating (not a security boundary, RLS still is) — and each app
consumes it via a **generated, not hand-written,** constants file. This is the same shape as
`scripts/regen-types.sh` already uses for the Supabase-generated TypeScript types: one source of truth,
mechanically reproduced into both apps, so there is exactly one place a human edits and no possibility
of the two copies disagreeing.

**First application (2026-09-19)**: `role_capabilities` table (migration `0009_role_capabilities.sql`)
+ `scripts/gen-role-capabilities.mjs`, generating `lib/generated/role-capabilities.ts` (web) and
`src/lib/generated/role-capabilities.ts` (mobile) — byte-identical modules exporting
`ROLE_CAPABILITIES`/`roleHasCapability()`. `proxy.ts`'s `ROLE_ROUTES` and `lib/roles-policy.ts`'s
`INVOICE_ROLES`/`SUBSCRIPTION_ROLES` now derive from it on web; mobile's `tab-sets.ts` derives from it
for the tabs that map cleanly to a capability (dispatch, drivers). Seeded to match pre-existing
behavior exactly — this was a refactor, not a policy change. Deliberately NOT migrated in this pass:
the ~20 other hand-rolled `_ROLES` arrays scattered across web page files, and mobile tabs with no
clean 1:1 capability match (Home, Customers, More) — extending `role_capabilities` to cover those is
future work, not silently expanded here without an explicit decision on what each new capability should
mean.

**Enforcement (2026-09-21)**: `tests/role-capabilities-drift.test.ts` already protects the generated file
itself from drifting off the migration, but nothing stopped a *new* hand-rolled role-list array from being
introduced elsewhere going forward. `check-architecture.mjs`'s `rule-h-role-list-literal` check now flags
an array literal of 2+ role-name string literals (`['owner', 'dispatcher', ...]` or
`[...].includes(role)`) outside the generated `lib/generated/role-capabilities.ts` files in either app.
Necessarily a heuristic — an array of role names is indistinguishable from any other string array to a
regex — tuned against the current tree to skip comment lines (an early draft flagged `lib/roles-policy.ts`'s
own header comment, which quotes a role array as prose while explaining the `BILLING_ROLES` drift
incident). Run before being added: found 12 existing hits across 11 files — the pre-existing
`_ROLES` array debt this section already named above (`InviteMemberButton.tsx`, `MemberActions.tsx`,
`team/page.tsx`, `api/team/invite/route.ts`, `api/team/[id]/route.ts`, `api/onboarding/route.ts`,
`loads/[load_number]/page.tsx`, `vehicles/[vehicle_number]/page.tsx`, plus `lib/domain/role-permissions.ts`'s
`INVITABLE_ROLES` — a *different*, deliberately curated invite-role subset, not derived from
`role_capabilities`, so mechanically indistinguishable from debt even though it's designed — and mobile's
`app/onboarding/index.tsx` role picker). A new ratchet, not a zero-violations one, so kept `warn`: the
existing hits are reported as current debt, not fixed in this pass, and the check's job from here is
catching the *next* one before it's added.

**What this does NOT change**: RLS remains the actual security boundary for data access — this rule is
about eliminating *hand-duplicated* logic, not about moving every rule into the database regardless of
nature. Money/date/number formatting is explicitly excluded — that's inherently a per-client
presentation concern (`Intl` APIs are client-side by nature), not a shared business rule, so each app
having its own formatting helper is correct, not a violation of this rule.

### Rule I — Every locale-varying value resolves through one inheritance chain; never a literal fallback

**This section is a living list.** Its purpose is different from Rules A-H: those are patterns found
by auditing the code. This one specifically tracks cases where **an architectural requirement already
existed and an AI build pass did not honor it** — so a future session (human or AI) can be handed this
file and told "these are known failure modes for this codebase specifically, do not repeat them,"
rather than relying on a single conversation's context to carry the lesson forward. Append to it
whenever a new instance is found; do not just fix the instance and let the lesson evaporate.

**Entry 1 (found 2026-09-21, root cause predates this date).** `organizations.country`
(`CHECK IN ('US','CA','MX')`) and `organizations.currency` (`CHECK IN ('USD','CAD','MXN')`) exist as
real schema columns — the data model was scoped correctly to this product's actual regulatory domain
(IFTA is a US/Canada-specific interstate compact; MX is a real cross-border freight corridor, not
scope creep). But the **application layer never resolves them through one function** the way
`preferred_language`/`uom_system` correctly do (profile -> `carrier_details.default_language`, an
explicit inheritance chain with a schema comment documenting the shape). Instead: `carrierOrg?.currency
?? 'USD'` is repeated as a literal fallback across ~20 files, and the US-state picker
(`AddCustomerButton.tsx`) never branches on `organizations.country` at all — a CA/MX org sees the wrong
list outright, not just a fallback. Exception/reminder text generated inside Postgres functions
(`'Invoice overdue'::TEXT`, `'CDL expiring'::TEXT`, etc.) has the same root shape: no resolution
chain, English hardcoded at the source.

**The rule**: every value that legitimately varies by locale/region (language, units, currency,
country, state/province list, date format, generated user-facing text) must resolve through exactly
one function/inheritance chain per value, the same shape already correctly used for
`preferred_language`/`uom_system` — never a literal default typed inline at each call site. This
does not mean "support every country" — the North-America-only scope was and is correct. It means:
even for 3 supported countries, there is one place that decides the currency for a given org, not
twenty places each independently defaulting to USD.

**How this should have been caught earlier, for future prompting**: when an architecture doc
establishes a pattern for one class of value (here: locale-derived org settings), an explicit
instruction to an AI build pass should say so out loud — *"apply the same resolution-chain pattern
used for `preferred_language`/`uom_system` to every other value in this same category (currency,
country, date/number formats), not just the one value being worked on right now."* Without that
explicit generalization instruction, an AI implementing feature N tends to solve exactly feature N's
immediate need (a money-formatting call site needing *a* currency, right now) and reach for the
nearest literal that makes the type-checker happy, rather than noticing the existing sibling pattern
a few files away and extending it. The fix going forward is not "the AI should have known" — it's
**naming the required generalization explicitly in the prompt/requirement**, the same way Rule H
above was only fixed after someone asked the direct question "is the backend actually common for both
clients?" instead of assuming an earlier "yes" covered it.

**Not yet fixed** (tracked here so it isn't silently forgotten): the state list is still hardcoded and
the SQL-generated English strings still have no resolution chain — neither is mechanically gated yet.

**Enforcement (2026-09-21)**: `check-architecture.mjs`'s `rule-i-currency-literal-fallback` check now
flags a literal `'USD'`/`'CAD'`/`'MXN'` used as a `??`/`?:` fallback or branch result, outside
`lib/format-money.ts`'s own default parameter (`formatMoney`'s `currency = 'USD'` is a generic
formatter's last-resort default, not a per-call-site duplication of an org's actual currency — the thing
this rule is actually about). Run before being added: found **16 call sites across 10 files** in
`carrieros-web` (mobile's own hardcoded `'USD'` is in `lib/format-money.ts` itself, already documented in
that file's header as a deliberate, scoped-for-now limitation, so it's excluded the same way web's is) —
`carrierOrg?.currency ?? 'USD'`/`org?.currency ?? 'USD'` repeated per page
(`customers/[customer_number]`, `loads/[load_number]` x2, `drivers/[driver_number]` x3,
`invoices/page`, `invoices/[invoice_number]` x2, `vehicles/[vehicle_number]` x5,
`api/invoices/[id]/factor/route.ts`), plus `api/onboarding/route.ts`'s `country === 'CA' ? 'CAD' : ...`
ternary — which computes the currency inline at org-*creation* time and would in fact be the natural home
for the "one resolver" this rule asks for, but isn't yet. This is a smaller count than this entry's
original "~20 files" estimate above (16 call sites across 10 files) — the original figure was an
eyeball count from the audit that prompted this entry, not a mechanical one; left both numbers here
rather than silently picking one, since neither was independently re-verified against the other. None
of the 16 are fixed in this pass — this is a ratchet (`warn`), not a hard gate, so the next new literal
fallback is what it catches, same posture as Rule H above.

### Rule J — Dependency-audit gate: no HIGH/CRITICAL vulnerability in a production dependency goes unnoticed

**This section is a living list**, same framing as Rule I: it tracks a class of pre-existing gap this
codebase already has, not a pattern with zero violations to hold the line on. Supply-chain risk (a
disclosed CVE in a package actually shipped to production) previously surfaced only via a manually-run
`npm audit`, which nobody was running on any cadence — so a HIGH/CRITICAL vulnerability could sit
unnoticed indefinitely in either app's production dependency tree.

**The rule**: `npm audit --omit=dev` (production dependencies only — a devDependency vulnerability, e.g.
in a test runner, never ships to a customer and isn't in scope here) must be run against both
`carrieros-web` and `carrieros-mobile` as part of the regular compliance check, not as a separate
manual step someone has to remember.

**Enforcement (2026-09-21)**: `check-architecture.mjs`'s `rule-j-dependency-audit` check runs `npm audit
--omit=dev --json` against both apps and warns (does not fail `verify:compliance`) if any HIGH or
CRITICAL severity vulnerability is found. Warn-only for a reason distinct from every other rule in this
document: an `npm audit` result can change out from under a completely unmodified tree the moment the
advisory database updates — zero code change required to go from 0 to N violations — so a hard gate
would spuriously break the compliance check on an unrelated commit the day a new CVE is filed against an
already-pinned version. Run against the current tree: `carrieros-web` has **1 critical (`next`) + 5 high**
(`browserslist`, `nanoid`, `nodemailer`, `postcss`, `sharp`); `carrieros-mobile` has **8 high, 0 critical**
(`@xmldom/xmldom`, `brace-expansion`, `browserslist`, `image-size`, `js-yaml`, `metro`,
`metro-config`, `metro-transform-worker`) — real, pre-existing exposure this pass surfaces but does not
fix; upgrading is a separate, scoped piece of work (`next` in particular is a major-version bump).

### Rule K — Migration expand/contract safety: no single-step breaking schema change against a live table

Migrations and app deploys happen independently in this codebase (`scripts/db/migrate.mjs` runs
separately from the app release) — so for the duration of any rolling deploy, old application code can
still be running against a newly-migrated schema. A migration that `DROP COLUMN`s, `RENAME COLUMN`s,
changes a column's data type (`ALTER COLUMN ... TYPE`), or `DROP TABLE`s in one step breaks that old
code immediately, the moment the migration applies — not at the next deploy. `ADD COLUMN ... NOT NULL`
with no `DEFAULT` is the same hazard in the other direction: an in-flight `INSERT` from old code that
doesn't know the column exists fails immediately, instead of getting a default value.

**The rule**: a breaking schema change against a table already in production is always two migrations,
never one — **expand** (add the new column/table alongside the old, backfill, ship app code that
tolerates both shapes) then **contract** (remove the old shape only once nothing reads it anymore, in a
later migration once the expand side has been live long enough that no old-code instance is still
running against it).

**Enforcement (2026-09-21)**: `check-architecture.mjs`'s `rule-k-migration-expand-contract` check scans
every file in `supabase/migrations/*.sql` for `DROP COLUMN`, `ALTER COLUMN ... TYPE`/`SET DATA TYPE`,
`DROP TABLE`, `RENAME COLUMN`, and `ADD COLUMN ... NOT NULL` with no `DEFAULT` in the same statement, and
warns (does not fail `verify:compliance`) on any hit. Warn-only, same posture as Rule H's heuristic
checks: this is a plain text/regex scan of the `.sql` body with no way to know from the file alone
whether a given single-step change is actually safe (e.g. a table added and dropped again within the
same release, never having reached a live deploy) — that remains a human call. Run against the current
26 migrations: **0 hits today** — every migration so far has only added columns/tables, and the one
existing `NOT NULL` addition (`features.retained_when_delinquent`, migration `0021`) already carries a
`DEFAULT`. A clean baseline to hold going forward, not a pre-existing-debt list like Rule H/I's.

### Rule L — Every org-scoped table has a cross-tenant RLS-isolation test

**This section is a living list**, same framing as Rule I: it tracks a real, pre-existing gap, not a
zero-violation pattern. Every table carrying `carrier_org_id` (this schema's universal tenant-scoping FK,
per §1) depends entirely on its RLS policy to keep org A from reading or writing org B's rows — and
until this pass, the only thing that had ever verified that in an automated, repeatable way was
`tests/rls-isolation.test.ts`, which covers exactly four tables (`loads`, `invoices`, `vehicles`,
`drivers`). Every other `carrier_org_id` table's isolation had only ever been checked manually, once, by
hand, if at all — the same "manual, run once" gap `tests/rls-isolation.test.ts`'s own header comment
names as the reason it exists at all.

**The rule**: every table with a `carrier_org_id` column needs a real cross-tenant test — two orgs, a
session authenticated as org B, an assertion that org B's session sees/affects zero rows for org A's
data (`tests/rls-isolation.test.ts`'s pattern: direct `.from(table)` select/update from org B's session
against an org-A-owned row, asserting an empty result rather than an error, since RLS filters silently).
A table that's only exercised by non-isolation tests (business-logic correctness, tier gating, etc.)
still counts as uncovered — those tests don't prove the RLS boundary holds.

**Enforcement (2026-09-21)**: `check-architecture.mjs`'s `rule-l-org-isolation-test` check parses every
`CREATE TABLE`/`ALTER TABLE ... ADD COLUMN` in `supabase/migrations/*.sql` for a `carrier_org_id`-shaped
column to build the full list of org-scoped tables, then cross-references each one against
`carrieros-web/tests/` for a matching isolation test, and warns (does not fail `verify:compliance`) on
any table with none found. Necessarily a heuristic, same posture as Rule H: it identifies a candidate
"isolation test file" as one whose filename or content matches `/isolation|cross-org|cross-tenant/i` —
the vocabulary this codebase's own tests already use (`rls-isolation.test.ts`,
`security-public-api.test.ts`'s `"tenant isolation"` describe block, `tests/audit/roles-rls.test.ts`,
etc.) — and then checks whether that file references the table by name. It cannot verify a matching test
actually asserts cross-org denial for that specific table, only that the table and isolation vocabulary
co-occur in the same file. Run against the current schema and test tree: **18 org-scoped tables found;
4 have no matching isolation test today** — `customer_contacts`, `dvir_inspections`,
`maintenance_reminders`, `vehicle_documents`. A real, pre-existing gap this pass surfaces but does not
fix — writing the missing tests is separate, scoped follow-up work, tracked here as a living list per
Rule I's precedent, not a hard gate.

---

## 4. First production hardening pass (2026-07-22)

This is production code for production use — these rules are not a one-off validation exercise, they
are the permanent standard this codebase is held to going forward. The two confirmed live bugs above
were fixed as the first real, permanent application of Rules A and B (not a prototype to be redone
later):

- `lib/domain/load-status.ts` (web) — Rule A applied to `loads.status`, consumed by the 5 most
  duplicated web call sites. Mobile's `theme.ts` copy migrated in a later pass, see below.
- `lib/roles-policy.ts` (web) — Rule B-adjacent: a single shared source for role-gating arrays,
  resolving the `BILLING_ROLES` drift as an explicit product decision rather than silently picking one
  of the two conflicting sets.
- `dashboard/page.tsx` + `proxy.ts` — exhaustive role handling so `sx_owner`/`sx_finance`/`sx_support`
  (and any future role) never silently render blank.
- `lib/domain/invite-status.ts`, `invoice-status.ts`, `vehicle-status.ts` (2026-07-22, Wave 2 of the
  `components/ui/` page migration) — Rule A applied to `drivers.invite_status`, `invoices.status`, and
  `vehicles.status`, the three remaining duplicated-across-files enum-like columns found while
  migrating `customers/[customer_number]`, `drivers/page`, `drivers/[driver_number]`, and
  `vehicles/[vehicle_number]` to `components/ui/StatusBadge`. `lib/domain/driver-compliance.ts` also
  extracted (`cdlGlowStatus()` was byte-for-byte duplicated between the drivers list and detail pages).
  All 9 of these pages/modules are now on shared Rule A modules — no known duplicated status-color
  logic remains in `carrieros-web`.
- `carrieros-mobile/src/constants/theme.ts` (2026-07-22) — Rule A mirrored into mobile (no shared TS
  package between apps, per §1's caveat): `LOAD_STATUS_PILL`, `VEHICLE_STATUS_PILL`, and
  `INVOICE_STATUS_PILL` are now each built from an exhaustive switch rather than a hand-written
  `Record` literal, closing the "mobile copy not yet migrated" gap noted above. Doing this surfaced a
  real, live bug: `LOAD_STATUS_PILL` had no `cancelled` case, so `history.tsx` (which explicitly
  includes cancelled loads) silently rendered them with the `draft` gray pill — exactly the failure
  mode Rule A exists to turn into a compile error instead.
- `lib/queries/profiles.ts` (2026-07-22) — Rule B's first real application, matching the rule's own
  example function signature exactly. Migrated the 20 call sites (mostly API-route authz context) that
  hand-wrote the identical `select('org_id, role').eq('id', user.id).single()` query. `profiles` was
  §2's top-cited gap (56 raw call sites) — this covers the single most duplicated shape, not all 56;
  further profiles shapes (language/date-format preference reads) remain unmigrated, per Rule B's own
  incremental-adoption text.
- Rule C's first real application (2026-07-22) — fixed the two routes §2 specifically cited as
  violations: `api/customers/route.ts` (was leaking the PostgREST relationship-embed key
  `organizations!customer_details_org_id_fkey` onto the wire) and `api/drivers/route.ts` (was leaking a
  nested `profiles(...)` embed; `components/DispatchPanel.tsx`, its only consumer, updated to match the
  flattened shape). `api/vehicles/route.ts` and the customer-contacts GET route also moved to explicit
  DTO construction even though they had no embed leakage, per Rule C's "even a 1:1 mapping" text. The
  ~20 other API routes are not yet audited against Rule C — this pass fixed the cited examples, not
  every route.
- `lib/storage/` and `lib/auth-admin/` (2026-07-22) — Rule G's first real application. All 4 web
  storage call sites (document upload/delete, customer logo signed URLs) and all 9 admin-auth call
  sites (invite/delete/impersonate/cron digest) migrated onto the new provider interfaces. Verified
  live: uploaded and deleted a real document through `StorageProvider`, invited and deleted a real
  driver through `AuthAdminProvider`, confirmed `/team`'s member list (via `listUsers`) still renders
  correctly — all through the Supabase-backed implementation, unchanged behavior, seam now in place for
  whenever a provider swap is actually needed.

---

## Changelog

| Date | Change |
|---|---|
| 2026-09-21 | Added Rules J (dependency-audit gate), K (migration expand/contract safety), L (org-scoped-table isolation-test heuristic) — all three enforced via new `warn`-only `check-architecture.mjs` checks (`rule-j-dependency-audit`, `rule-k-migration-expand-contract`, `rule-l-org-isolation-test`), same non-blocking, living-list posture as Rule I. Rule J: `npm audit --omit=dev` against both apps found 1 critical + 5 high in `carrieros-web`'s production dependencies, 8 high in `carrieros-mobile`'s — real, pre-existing supply-chain exposure, not fixed in this pass. Rule K: scanned all 26 migrations for single-step `DROP COLUMN`/`RENAME COLUMN`/type-change/`DROP TABLE`/un-defaulted `NOT NULL` `ADD COLUMN` — 0 hits, a clean baseline rather than a debt list. Rule L: cross-referenced the 18 `carrier_org_id`-scoped tables (parsed from `supabase/migrations/*.sql`) against `carrieros-web/tests/` for a matching cross-tenant isolation test — `customer_contacts`, `dvir_inspections`, `maintenance_reminders`, `vehicle_documents` have none today, a real pre-existing gap surfaced but not fixed here. |
| 2026-09-21 | Made architectural requirements mechanically enforced where realistic, closing gaps Rule I's own framing named ("requirements existing but not being mechanically enforced"). Added to `check-architecture.mjs`: `rule-a-status-color-duplication` (Rule A, `warn` — found one pre-existing hit, `app/track/[token]/page.tsx`'s deliberately-separate `STATUS_COLOR` map), `rule-h-role-list-literal` (Rule H, `warn`, new ratchet — found 12 pre-existing hits across 11 files), `rule-i-currency-literal-fallback` (Rule I, `warn` — found 16 pre-existing hits across 10 files, a smaller count than this doc's earlier "~20" estimate, noted as a discrepancy rather than silently trusting either number). Added a Rule E gate to `scripts/db/migrate.mjs` and `scripts/db/verify-migrations.mjs`: every migration must carry a header comment (verified against all 26 existing migrations first — none needed changes, since this requires the practice they already followed, not a new one). Assessed Rule F for a lightweight gate and deliberately added none — only 6/87 existing routes even mention R3b today, so a required comment would be new ceremony, not mechanizing a habit, and a comment's *presence* can't verify its *correctness* anyway. Re-verified Rule C by hand across all 87 API routes (not just the 9 fixed in 2026-07-23) — zero new violations; the newer `server/`-layered `/api/v1` and `/api/public/v1` routes already satisfy it via Zod-validated response schemas. Confirmed Rule D still has no automated check (a deliberate judgment call, not an oversight) and Rule G still passes with zero violations. Left Rule B's enforcement level unchanged (`warn`) — the check already runs on every commit, but running is not the same as the ~109-call-site debt being closed; that requires the `lib/queries/*` migration itself, out of scope for this pass. |
| 2026-09-21 | Added Rule I (every locale-varying value resolves through one inheritance chain, never a literal fallback) — a new kind of entry, specifically for architecture requirements that existed but an AI build pass didn't honor, meant to be appended to over time rather than treated as a one-time finding. Entry 1: `organizations.country`/`currency` columns exist correctly-scoped, but ~20 call sites hardcode `?? 'USD'` instead of resolving through one function the way `preferred_language`/`uom_system` correctly do; state picker never checks `country` at all; SQL-generated exception text is hardcoded English. Not yet fixed or mechanically gated — tracked so it isn't silently forgotten. |
| 2026-09-19 | Added Rule H (cross-client shared logic goes in Postgres, single-sourced, never hand-duplicated TypeScript), prompted by an audit finding the web/mobile "common backend" question was only partially true. First application: `role_capabilities` table + `scripts/gen-role-capabilities.mjs`, replacing `proxy.ts`'s `ROLE_ROUTES` and `lib/roles-policy.ts`'s hardcoded arrays on web, and the dispatch/drivers tabs in mobile's `tab-sets.ts`, with a generated shared source. |
| 2026-07-22 | Initial version — drafted from two research passes (coupling quantification + existing-convention catalog) prompted by a direct question about schema-change blast radius. First production hardening pass applied to `loads.status` and role-gating arrays; Rule E's impact-analysis step added permanently to `supabase/schema/README.md`'s workflow. |
| 2026-07-22 | Wave 2 of the `components/ui/` page migration closed out Rule A: added `invite-status.ts`, `invoice-status.ts`, `vehicle-status.ts`, and `driver-compliance.ts`, migrating the last 4 pages with local status-color duplication onto shared modules. |
| 2026-07-22 | First real application of Rules B and C: `lib/queries/profiles.ts` added and 20 call sites migrated onto it (Rule B); `api/customers` and `api/drivers` routes' Postgrest-embed leakage fixed with explicit DTOs, `api/vehicles` and customer-contacts GET moved to explicit DTOs too (Rule C). Both rules remain partially applied by design — incremental adoption, not a full-codebase migration in one pass. |
| 2026-07-22 | Rule A mirrored into `carrieros-mobile/src/constants/theme.ts`, closing the last unmigrated Rule A gap and fixing a real live bug found in the process (`LOAD_STATUS_PILL` missing a `cancelled` case, silently rendering cancelled loads as drafts in `history.tsx`). |
| 2026-07-23 | Documentation alone did not stop a real regression (SuperAdmin UI's first draft bypassed `components/ui/*` and used ad hoc Tailwind instead — see `docs/design/carrieros-design-system.md` §11). Added mechanical gates rather than relying on these rules being re-read: `carrieros-web/scripts/check-architecture.mjs` (static grep, no DB, wired into a pre-commit hook) enforcing Rule B/D's "business/query logic must not import React/Next.js/components" and Rule G's "call sites must go through `lib/storage`/`lib/auth-admin`, not the raw Supabase SDK" — verified zero pre-existing violations before being made a hard gate. See `CLAUDE.md`'s "Gated checks" section for the full hook setup (`git config core.hooksPath scripts/git-hooks`, since this repo has no CI). |
| 2026-07-22 | Added Rule G (provider-adapter boundary), prompted by a direct question about leaving Supabase for AWS and preparing for a possible future hyperscaler swap. Built `lib/storage/` and `lib/auth-admin/`, migrating all real call sites (4 storage, 9 auth-admin) onto them — same Supabase backend, no behavior change, verified live. |
| 2026-07-23 | Fixed the 9 concrete Rule C violations found while scoping the check-architecture.mjs expansion — `api/customers`, `api/customers/[org_id]/contacts`, `api/vehicles`, `api/drivers/invite`, `api/settlements/run`, `api/settlements/[id]/send-ach`, `api/billing/add-payment-method`, `api/billing/change-tier`, `api/admin/orgs/[org_id]/notes` were all piping a raw insert/update/rpc result straight to `NextResponse.json()`; each now constructs an explicit response object. Did **not** add an automated Rule C lint check — a real false-positive risk was found (can't reliably distinguish "raw Supabase row" from "already-reshaped variable" via regex without an AST parse), so this was a one-time manual fix, not a gate; a future session revisiting Rule C compliance should re-grep rather than assume this list is exhaustive. Also added a `warn`-severity (non-blocking) check to `check-architecture.mjs` for Rule B hot-table encapsulation (`profiles`/`loads`/`drivers` `.from()` calls outside `lib/queries/`) — 86 pre-existing call sites found, too large to gate as zero-violation yet; same ratchet posture as the UI lint guard. |
