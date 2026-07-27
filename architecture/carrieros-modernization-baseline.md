# CarrierOS modernization — baseline, findings and sequence

**Date:** 2026-07-26
**Status:** Phase 1 complete; Phases 2–3 and 6 substantially implemented; remainder sequenced below.

> **Where this file lives.** The brief asked for `docs/architecture/`. In this
> repo `docs/` is a **gitignored symlink** to an external Zoho WorkDrive folder
> (`.gitignore:10`), so anything written there has no version history and cannot
> be reviewed in a diff — the exact failure mode that
> `supabase/schema/README.md` documents for the schema file. The canonical copy
> therefore lives here, in the versioned `architecture/` tree. Mirroring it into
> `docs/architecture/` is safe and optional.

---

## 1. Baseline: what was true before any change

Recorded so that later failures can be attributed correctly.

| Check | Web (`carrieros-web`) | Mobile (`carrieros-mobile`) |
|---|---|---|
| Unit tests | **42 passed / 7 files** (Vitest) | **52 passed / 4 suites** (Jest) |
| Typecheck | clean | clean |
| Lint | **5 errors, 19 warnings** | **76 errors, 56 warnings** |
| Build | `next build` succeeds | n/a |
| E2E | **none exists** | **none exists** |
| CI | **none** — no `.github/`; enforcement is git hooks only |

**Pre-existing failures (NOT caused by this work).** All 5 web lint errors are
`react-hooks/set-state-in-effect` / `static-components` in
`components/ui/Modal.tsx` and four `app/(admin)/**` pages. All 76 mobile lint
errors are React Compiler rules across pre-existing screens. Both were present
before the first edit and remain unchanged. No test was failing at baseline.

---

## 2. Inventory

Full machine-readable detail in `architecture/inventory/`:
`web-supabase-usage.json`, `mobile-supabase-usage.json`, `database-inventory.json`
(each with a `.md` companion).

### 2.1 Direct Supabase access

| | Web | Mobile |
|---|---|---|
| Total occurrences | 376 | 131 |
| Table `.from()` | 296 (165 read / **131 write**) | 88 (62 read / **26 write**) |
| RPC | 18 (13 distinct) | 8 (6 distinct) |
| Storage | 10 (3 buckets) | 7 (all `documents`) |
| Auth | 48 | 10 |
| Realtime | 4 (one component) | 4 (one subscription) |
| Distinct tables | 33 | 21 |
| Already via HTTP API | n/a | 14 `apiFetch` call sites |
| Service-role call sites | **20** | 0 (correctly) |

Existing API routes: **41**, none versioned.

### 2.2 Highest-risk access patterns

1. **19 client-component writes across 13 tables (web).** RLS is the only
   authorization boundary for document CRUD, maintenance logs, fuel stops, IFTA
   crossings and `drivers` pay config (`components/DriverPayConfig.tsx:57`). No
   server-side validation stands in front of any of them.
2. **Client-side load state machine (mobile).** `src/app/load/[id].tsx` calls
   `PATCH /api/loads/:id` at line 179 but writes `loads` directly at 228 and
   inserts the `load_events` audit row at 238. The two writes are **not
   transactional**, so a failure between them leaves a status change with no
   audit record.
3. **`src/lib/offline-queue.ts:70`** replays `supabase.from(entry.table as any)
   .update(patch)` — arbitrary table/patch pairs from AsyncStorage. Any REST
   migration must redesign this to queue *API calls*, not table writes.
4. **`ifta_state_crossings` delete-then-insert** (`ifta-section.tsx:148-149`) is
   a non-atomic replace on tax-filing data.
5. **Unauthenticated service-role entry point.** `app/api/intake/email/route.ts:69`
   resolves the target org from an inbound email `to:` header, then writes with
   the service-role client.
6. **Non-transactional storage+table writes**, repeated in four components, with
   inconsistent ordering — partial failure orphans either a row or a blob.

### 2.3 Database

40 tables + 1 view. **RLS enabled on 40/40, every one with ≥1 policy.** 95 public
policies, 18 functions, 2 triggers, 0 enum types, **0 tables with FORCE RLS**.

- **14 tables have no direct tenant column.** Nine are global reference catalogs
  (by design); `organizations` is self-tenant; **four rely on a policy subquery
  joining back to the parent** — `dvir_defects`, `driver_message_translations`,
  `load_events`, `settlement_deductions`. All verified correct today, but their
  isolation lives entirely in policy text.
- **16 of 18 functions are `SECURITY DEFINER`**, all with `search_path=public`.
- **No trigger contains business logic** (both are `updated_at` bookkeeping) —
  good; nothing to unwind.
- **Statuses today:** `loads.status` = draft, scheduled, dispatched, picked_up,
  in_transit, delivered, invoiced, paid, cancelled, declined.
  `invoices.status` = draft, sent, paid, overdue. **Customers have no status
  column at all** — no `is_active` anywhere on `customer_details`,
  `customer_contacts` or `organizations`, contradicting the
  deactivate-never-delete rule that `drivers`/`vehicles`/`profiles` follow.

### 2.4 `has_feature()` — the entitlement defect

It is a single comparison: `rank(carrier_details.tier) >= rank(features.min_tier)`.
It consults **nothing else**. Confirmed ignored:

| Column | Populated? | Read by `has_feature()`? |
|---|---|---|
| `billing_status` (`trialing/active/past_due/canceled`) | yes, NOT NULL | **no** |
| `trial_ends_at` (default `now() + 90d`) | yes | **no** |
| `grace_period_until` (written by admin UI) | yes | **no** |
| `org_flag_overrides` | table exists | **no** |
| `platform_flags` | table exists | **no** |

**Consequence:** a `canceled` organization, or one whose trial expired months
ago, retains every feature. The only revocation path is mutating `tier`, which
also destroys the record of what was purchased and is indistinguishable from a
downgrade. It returns **NULL, not false**, for non-carrier orgs and unknown
keys — fail-closed by luck rather than design. **Zero SQL callers**; all 21
call sites are application code (16 web, 5 mobile).

---

## 3. Security findings

| # | Finding | Severity | Status |
|---|---|---|---|
| S1 | `anon` held `TRUNCATE` on all 40 public tables. TRUNCATE bypasses RLS entirely. Not reachable through PostgREST, so latent rather than open. | High (latent) | **Fixed** — migration `0003` |
| S2 | `create_customer_org` and `bulk_import_customers` are `SECURITY DEFINER` with default `PUBLIC` EXECUTE, guarded only by an in-body raise. | High | **Fixed** — migration `0003` |
| S3 | Baseline grants `authenticated` INSERT/UPDATE/DELETE on **every** table including reference catalogs; only RLS stops `DELETE FROM tiers`. | Medium | **Fixed** — migration `0002` |
| S4 | `check_ifta_completeness(p_load_id)` performs **no tenant check** — any authenticated user can probe another carrier's load. | High | **Open** — needs call sites migrated first; see §5 |
| S5 | `app/api/intake/email/route.ts` derives tenant from an unauthenticated email header, then uses service-role. | High | **Open** |
| S6 | Cross-tenant `auth.admin.listUsers({perPage:1000})` on a per-tenant page (`team/page.tsx:45`, `api/team/route.ts:27`) — pulls the entire auth user table and filters in memory. | Medium | **Open** |
| S7 | `lib/api-auth.ts:95` re-exports `createAdminClient`, widening the service-role import surface for no benefit. | Low | **Open** |
| S8 | `loads_driver_view` carries INSERT/UPDATE/DELETE grants a view of that shape cannot honour. | Low | **Open** |
| S9 | Schema drift: `profiles.users_read_own_profile` existed live but not in `schema.sql` — would have vanished on the next replay. | Medium | **Fixed** — migration `0004` |

---

## 4. What has been implemented

### Phase 2 — versioned migrations ✅
`supabase/migrations/` with an enforced-immutable runner
(`scripts/db/migrate.mjs`, SHA-256 checksum per applied file) and a verifier
(`scripts/db/verify-migrations.mjs`) running **9 checks**, all passing:
clean build from migrations, ordering/uniqueness, bookkeeping present,
migrations reproduce the reviewed snapshot, **baseline→head upgrade converges
with a fresh build**, catalogs not writable, bookkeeping not client-readable,
RLS-without-policy detection with an explicit deny-all allowlist, and deny-all
tables unreachable by client roles.

`0001_baseline_schema.sql` is a **verbatim** capture — no cleanup folded in, so
a baseline and the thing it baselines cannot disagree. Fixes ship forward as
`0002`–`0005`. `schema.sql` is retained as the reviewed current-state snapshot
and is diffed against migrations by the verifier.

### Phase 3 — layered architecture ✅ (skeleton + enforcement)
`carrieros-web/server/{domain,application,ports}` with **enforced** boundaries
added to `scripts/check-architecture.mjs` as hard errors:
`server-domain-purity`, `server-application-purity`, `server-ports-purity`,
`v1-route-delegation`. Verified by probe: a `react` import in `server/domain`
exits 1; removing it exits 0.

### Phase 6 — entitlements ✅ (engine + tests + adapter)
`server/domain/entitlement/model.ts` is a pure decision over an explicit
snapshot, separating subscription status, tier, capability, usage limit,
effective period, trial, grace, suspension, per-org override and platform flag.
Ordered evaluation: kill switch → capability exists → carrier org → deny
override → standing → retained-when-delinquent → grant override → tier.
**24 unit tests pass**, several written specifically to pin the `has_feature()`
defects. `EntitlementService.hasFeatureCompat()` is a lossy, deliberately
unattractive compatibility shim so the 21 legacy call sites can migrate one at
a time.

### Phase 8 — outbox infrastructure ✅ (schema)
Migration `0005` adds `outbox_events` (unique `idempotency_key`, attempts,
`next_attempt_at`, dead-letter status, `replayed_from_id`), `idempotency_keys`
(request-hash reuse detection, 24h retention) and append-only `audit_events`
(prior/new state, reason, actor, correlation, expected version; no UPDATE or
DELETE grant to any role).

---

## 5. Remaining sequence

Ordered by risk-reduction per unit of change. Each step keeps the app runnable.

1. **Infrastructure adapters + `/api/v1` skeleton.** `SupabaseEntitlementRepository`,
   `PostgresUnitOfWork` (over a SQL command function, since PostgREST cannot span
   statements), `SystemClock`, `UuidGenerator`; problem+json, correlation-id and
   Idempotency-Key middleware; `GET /api/v1/entitlements` as the first endpoint.
2. **Highest-risk vertical slice: load status + milestone.** Fixes finding #2 —
   status change, `load_events` audit and outbox event become one transaction.
   Retire the mobile client-side state machine.
3. **Offline queue redesign (mobile).** Queue API commands with
   `Idempotency-Key`, not table patches. Blocks finding #3.
4. **Documents/POD slice.** Upload session behind a storage adapter; fixes the
   four non-transactional storage+table writes and the client-side blob delete.
5. **Invoice submission + dispute slice**, then tender/booking once those
   aggregates exist.
6. **Close S4/S5/S6** once their call sites are behind services.
7. **Domain-state migrations** (Phase 7) — additive lifecycle columns first,
   dual-write, backfill, then contract. `loads.status` conflates execution,
   billing and cancellation and must be decomposed, not renamed.
8. **CI** (`.github/workflows`) — there is none today; the git hooks are the
   only gate. Add: lint, typecheck, architecture, unit, migration verify, RLS
   matrix, builds, secret scan.
9. **E2E** — Playwright (web) and Maestro/Detox (mobile) do not exist yet.

---

## 6. Assumptions made (per "document it and proceed")

1. **Canonical docs live in `architecture/`**, not `docs/` — see the note at the
   top. `docs/` cannot be committed.
2. **`schema.sql` stays hand-maintained**, verified against migrations by
   fingerprint diff rather than being replaced by `pg_dump` output. Its comments
   encode *why* policies exist (including five 2026-07-20 security fixes);
   generated output would destroy that. The verifier makes drift a build failure,
   which is a stronger guarantee than "regenerated" would give.
3. **`past_due` does not deny immediately.** A bounced renewal retries for days;
   cutting a carrier off mid-load is worse than briefly carrying them. Denial
   waits for the operator-set grace deadline. Reversible in one constant.
4. **Billing/export capabilities are retained while delinquent**
   (`retainedWhenDelinquent`), so a customer can always settle up or leave with
   their data.
5. **`suspended` was added** to the subscription vocabulary in the domain model
   but **not** to the `carrier_details.billing_status` CHECK constraint — that
   is a schema change with app-wide branch implications and belongs in its own
   migration with the call-site sweep the schema README mandates.
6. **Nothing was committed.** Per the brief. `git status` shows the full change
   set for review.
