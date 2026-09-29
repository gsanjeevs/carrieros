# 05 — Database & Migrations

## 1. Purpose

CarrierOS runs on **Postgres via Supabase**. Supabase gives us the managed
Postgres instance, an `auth.users` table plus `auth.uid()`, storage
(`storage.objects`), realtime, and a local dev stack (`supabase start` under
Docker) that mirrors production closely enough to be trustworthy.

Schema changes are **hand-written SQL migrations**, not an ORM (no Prisma
schema, no Drizzle migrations, no ActiveRecord-style DSL). This is a
deliberate choice, not an oversight: the security-critical layer of this
system is **Row Level Security (RLS) policies**, and RLS policies are
Postgres-native SQL with no faithful abstraction in any JS/TS ORM. Writing
migrations directly in SQL means the policy text you write is exactly the
policy text that runs — nothing is generated, translated, or subtly
reinterpreted between the file you review and the database.

**Data model shape.** CarrierOS is multi-tenant with **one `organizations`
row per carrier** (plus rows of type `customer` for each carrier's shipper
customers, and one `type='platform'` row for ShipmentX itself, the SaaS
operator). Every tenant-owned table carries a `carrier_org_id` or `org_id`
column, and access to that row is gated by an RLS policy keyed off the
caller's own `profiles.org_id` — not by anything the application layer
decides to filter on. That is the actual security boundary, and it is why
QA needs to understand RLS specifically, not just the table list, when
designing test scenarios (see §3b and §5).

## 2. File structure

```
supabase/
  migrations/           # 61 files (0000-0060), the schema AUTHORITY.
                         # Never edit a merged one — see §4/§5.
  schema/
    schema.sql           # 6,208-line hand-maintained REVIEWED SNAPSHOT of
                          # current schema state. CI checks it matches what
                          # migrations produce; it is not itself applied to
                          # build a real environment anymore.
    README.md             # Historical: describes the OLD pre-migrations
                          # workflow (ad hoc psql + hand-copy). Superseded by
                          # architecture/database-migrations.md — read that
                          # instead for the current process, but this file's
                          # "ordering matters" and replay-before-commit notes
                          # are still accurate background.
  templates/
    invite.html           # Supabase auth email template (not schema).
  snippets/                # Empty — reserved for saved SQL snippets.
  .branches/, .temp/        # Local `supabase start` runtime state, gitignored.

scripts/db/
  migrate.mjs             # Applies pending migrations; --status / --dry-run /
                          # --baseline. See §4.
  verify-migrations.mjs    # The CI gate: 9 checks against throwaway
                          # databases. See §3c.
  gen-erd.mjs              # Generates architecture/erd.md from the live
                          # schema. Run with --check in CI to catch a stale
                          # ERD. Do not hand-edit erd.md.

carrieros-web/scripts/
  load-demo-data.mjs       # QA/local demo-data loader (rerunnable). See §5.
  seed-staging-demo.mjs     # Older one-shot seeder, superseded but kept.
  check-staging-drift.mjs   # Unrelated to schema — compares deployed app
                          # code, not data.

scripts/reset-demo.sh      # Resets the 2 persistent local demo users' prefs
                          # (language/units/date format) — not schema, not
                          # the extra ShipmentX-admin demo orgs. See §5.
```

`supabase/schema/schema.sql` and `supabase/migrations/` can look redundant
at a glance — they're not. Migrations are the thing you write and run;
`schema.sql` is a generated-by-hand-then-machine-checked reference so a
reviewer (or a QA engineer) can read "what does the schema look like today"
in one file instead of replaying 61 of them mentally. See §3c for exactly
what keeps them in sync.

## 3. Key concepts, with real examples

### 3a. A representative migration — style and conventions

Every migration is a numbered file, `<4-digit-ordinal>_<snake_case_name>.sql`,
and every one **must start with a header comment** naming the file and
explaining the change's impact (this is enforced by tooling — see §3c).
`supabase/migrations/0053_loadboard_postings_tenancy.sql` is a good
representative example: small, self-contained, and it explains *why*, not
just *what*:

```sql
-- 0053_loadboard_postings_tenancy.sql
--
-- Fixes forward a real tenancy gap in migration 0052 (found while writing tests/rls-isolation.test.ts
-- for loadboard_postings, immutable now that it's applied -- see CLAUDE.md's migration-immutability
-- rule): the carrier_loadboard_postings_insert RLS policy only checks
-- `carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')`. RLS validates the row
-- being written, not what its foreign keys point at -- nothing stopped a caller from inserting
-- carrier_org_id = their OWN org while load_id points at a DIFFERENT org's load, since the FK on
-- load_id only requires the referenced load to exist somewhere, not that it belongs to the same
-- carrier_org_id on the row.
CREATE OR REPLACE FUNCTION enforce_loadboard_posting_tenancy() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.load_id IS DISTINCT FROM OLD.load_id OR NEW.carrier_org_id IS DISTINCT FROM OLD.carrier_org_id)
     AND NOT EXISTS (SELECT 1 FROM loads WHERE id = NEW.load_id AND carrier_org_id = NEW.carrier_org_id) THEN
    RAISE EXCEPTION 'load does not belong to this carrier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER loadboard_postings_tenancy BEFORE INSERT OR UPDATE ON loadboard_postings
  FOR EACH ROW EXECUTE FUNCTION enforce_loadboard_posting_tenancy();
```
(`supabase/migrations/0053_loadboard_postings_tenancy.sql:1-25`)

The recurring pattern worth internalizing: **RLS policies validate the row
being written, but cannot validate what a foreign key on that row points
at.** A tenant-isolation trigger like this one is the fix whenever a table
has a foreign key into another tenant-owned table (see `0019` below for
the earlier, larger instance of the same fix).

### 3b. RLS policy excerpt — tenant isolation in practice

This is the actual security boundary QA needs to respect. From the `loads`
table's baseline policies:

```sql
-- LOADS
ALTER TABLE loads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_solo_loads_all" ON loads FOR ALL USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);
...
CREATE POLICY "dispatcher_loads_update" ON loads FOR UPDATE TO authenticated
  USING (carrier_org_id = my_org_id() AND my_role() = 'dispatcher')
  WITH CHECK (carrier_org_id = my_org_id() AND my_role() = 'dispatcher');
...
CREATE POLICY "driver_own_loads_select" ON loads FOR SELECT USING (
  driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid())
);
...
CREATE POLICY "customer_loads_select" ON loads FOR SELECT USING (
  customer_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid() AND is_active = true)
  AND (SELECT role FROM profiles WHERE id = auth.uid() AND is_active = true) IN ('customer_admin','customer_viewer')
);
```
(`supabase/migrations/0001_baseline_schema.sql:1548-1594`)

What this means for QA test design:
- **Every table with RLS enabled needs a policy, or is an explicit, reviewed
  deny-all** (server-only tables like `outbox_events`, `oauth_clients`,
  `admin_support_access_sessions` — see the `DENY_ALL_BY_DESIGN` list in
  `scripts/db/verify-migrations.mjs:381-394`). If a table returns zero rows
  where you expect data, check whether it's an RLS deny before assuming the
  data is missing.
- **A driver only sees loads assigned to them**, not the whole carrier's
  loads — testing "driver visibility" means creating a load assigned to a
  *different* driver in the same org and confirming it does NOT appear.
- **A customer portal user only sees their own org's loads** via
  `customer_org_id`, gated by `is_active = true` — a deactivated portal
  contact loses access immediately, which is a real scenario worth testing
  (revoke access, confirm the old session can no longer read anything).
- **Cross-tenant isolation is the single highest-value thing to test.** Two
  different carrier orgs must never see each other's rows, full stop. This
  is exactly what `carrieros-web/tests/rls-isolation.test.ts` automates —
  it spins up two orgs (A, B) and asserts org B can never read or write
  org A's rows on `loads`, `invoices`, `vehicles`, `drivers`, and the
  platform-admin tables. That test file is a good reference for what
  "safe test data" for RLS scenarios looks like in code, even if you're
  testing through the UI instead.
- **Vocabulary columns are `TEXT + CHECK`, not Postgres enums** — the
  database will reject an invalid `loads.status` value, but the generated
  TypeScript types are plain `string`, so a typo'd status won't be caught
  by `tsc`. See `architecture/inventory/database-inventory.md` §8 for the
  full list of valid values per column.

### 3c. `verify-migrations.mjs` — what breaks CI

`scripts/db/verify-migrations.mjs` is the CI gate for the whole migrations
system. It builds three **throwaway databases** (always prefixed
`migrationcheck_` — the script refuses to `DROP` anything without that
prefix) and runs 9 checks, dropping the databases afterward:

1. Migration filenames are uniquely numbered and start at `0000`.
2. **Every migration has a header comment** — must start with
   `-- <filename>` and have at least 3 lines of header before the first SQL
   statement (this is "Rule E" impact-analysis, from
   `docs/architecture-principles.md`; five early migrations are grandfathered
   via an explicit exception list since they're immutable now — see
   `scripts/db/verify-migrations.mjs:197-203`).
3. A clean database can be built from migrations alone.
4. The migration bookkeeping table (`schema_migrations`) exists after a
   clean build.
5. **Migrations reproduce `supabase/schema/schema.sql` exactly.** This is
   the check that keeps the "hand-maintained snapshot" honest: it builds one
   database from migrations and another from `schema.sql`, fingerprints both
   (tables, columns, constraints, indexes, RLS policies, functions,
   triggers, grants — via catalog queries, not `pg_dump`, because dump
   output reorders between runs), and diffs them. **If you write a migration
   and forget to hand-update `schema.sql` to match, this check fails CI.**
   There is no auto-generation step for `schema.sql` — someone has to edit
   it by hand alongside the migration.
6. An existing database baselined at `0001` can upgrade to head and land in
   an identical state to one built fresh from migrations — this exercises
   the real upgrade path a live environment takes, not just "create from
   scratch."
7. Reference catalogs (`tiers`, `features`, `languages`, etc.) are not
   writable by `authenticated`.
8. `schema_migrations` itself is not readable by `authenticated` or `anon`.
9. Every table with RLS enabled has a policy, or is on the explicit
   deny-all list — and every deny-all table is actually unreachable by
   `anon`/`authenticated` grants (the other half of that exemption: it must
   really be inaccessible, not just missing a policy).
10. No client role (`anon`/`authenticated`) holds `TRUNCATE` on any public
    table — `TRUNCATE` bypasses RLS entirely, and Postgres's default
    privileges silently re-grant it to every newly created table unless a
    migration explicitly revokes it.

(Checks 7-10 total, plus the header/uniqueness/build/reproduction/upgrade
checks above — the script and this doc both count "9 checks" as the named
`check(...)` calls in `scripts/db/verify-migrations.mjs`.)

### 3d. Domain/table structure — see the ERD, don't reproduce it here

`architecture/erd.md` is **generated** from the live schema by
`node scripts/db/gen-erd.mjs` (CI runs it with `--check` to catch a stale
ERD — don't hand-edit that file). As of the last generation: **65 tables,
126 foreign keys**, split into 6 domain diagrams because one diagram of
every table is unreadable:

1. **Tenancy, identity & entitlements** — `organizations`, `carrier_details`,
   `profiles`, `roles`, `tiers`, `features`, `role_capabilities`, and friends.
2. **Fleet** — `vehicles`, `drivers`, their documents, and maintenance.
3. **Loads & dispatch** — `loads` (the core shipment record), its timeline,
   expenses, documents, exceptions, driver chat.
4. **Billing & settlements** — `invoices`, `driver_settlements`,
   `settlement_deductions`, `billing_events`.
5. **Compliance & IFTA** — `fuel_stops`, `ifta_state_crossings`, `dvir_*`.
6. **Platform & infrastructure** — admin/audit tables, outbox, webhooks,
   AI provider config, `schema_migrations` itself.

Read `architecture/erd.md` directly for the full column-level diagrams and
FK relationships. For a security-and-ownership-focused view of the same 40+
tables (which have RLS, which are deny-all by design, which functions
bypass RLS via `SECURITY DEFINER`), read
`architecture/inventory/database-inventory.md` — it's a point-in-time audit,
not generated, so check its date before trusting exact counts.

## 4. How the migration workflow works, end to end

**1. Write the migration.** New file in `supabase/migrations/`, named
`<next-ordinal>_<snake_case_description>.sql`. It must start with a header
comment (`-- <filename>` on line 1, ≥3 lines of context before any SQL) —
`migrate.mjs` and `verify-migrations.mjs` both refuse to run a migration
missing one.

**2. Apply it locally.**
```bash
node scripts/db/migrate.mjs --status     # see what's applied vs pending
node scripts/db/migrate.mjs --dry-run    # list what would run, without running it
node scripts/db/migrate.mjs              # apply pending migrations
```
This talks to the local `supabase_db_carrieros` Docker container by default
(override with `PG_CONTAINER`), or a direct Postgres connection if
`DATABASE_URL` is set. Each migration runs inside **one transaction together
with its `schema_migrations` bookkeeping row** — a failure leaves nothing
half-applied, so a retry after fixing the SQL just re-applies cleanly.

**3. Hand-update `supabase/schema/schema.sql` to match.** Not automatic —
the check in §3c will fail otherwise. Ordering matters here: a policy that
calls a helper function (`my_org_id()`, `my_role()`) must appear *after*
that function is defined in the file.

**4. Verify before pushing.**
```bash
node scripts/db/verify-migrations.mjs
```
Runs the 9 checks from §3c against throwaway databases — this is exactly
what CI runs, so a clean local run means CI's `verify-migrations` step will
pass too.

**5. `.github/workflows/ci.yml`** (every push to `main`, every PR): starts a
real local Supabase stack, applies + verifies migrations, and runs the full
web lint/typecheck/Vitest suite (plus mobile typecheck/Jest). This is the
gate a PR must pass.

**6. `.github/workflows/deploy.yml`** (triggered on a successful CI run on
`main`, or manual `workflow_dispatch`) **auto-applies pending migrations to
the staging Supabase database** — confirmed by reading the workflow file
directly:
```yaml
jobs:
  migrate-staging:
    name: Migrate staging database
    if: ${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    environment: staging
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Pending migrations
        run: node scripts/db/migrate.mjs --status
      - name: Apply migrations
        run: node scripts/db/migrate.mjs
```
(`.github/workflows/deploy.yml:28-46`)

**Important nuance for QA:** this workflow migrates the **database** only.
It does **not** deploy the `carrieros-web` application — that still happens
via a manual `docker buildx build` + `aws ecs update-express-gateway-service`
sequence (see `architecture/deployment.md`). So a schema change reaching
staging and an app code change reaching staging are **not** the same event —
a migration can land on staging before (or without) the app code that uses
it, or vice versa. If something looks broken on staging after a schema PR
merges, check whether the app was actually redeployed
(`node carrieros-web/scripts/check-staging-drift.mjs` compares `origin/main`
against what's actually running).

## 5. Conventions and gotchas

- **No down-migrations, deliberately.** Confirmed in
  `architecture/database-migrations.md`: *"There are no `down` migrations,
  deliberately. A `down` that has never been run in anger is a false
  promise... Recovery is: roll back the application to the prior release,
  fix forward with a new migration, or restore from backup only for genuine
  data loss."* `architecture/deployment.md` confirms the same for staging:
  *"No rollback automation — roll the ECS service back to a prior image tag
  manually, fix the schema forward with a new migration."*

- **Migrations are immutable once applied — enforced by tooling, not just
  policy.** `migrate.mjs` re-hashes every applied file on every run and
  refuses to continue if a checksum changed. A `pre-commit` git hook
  (referenced in `CLAUDE.md`, `scripts/git-hooks/pre-commit`) also blocks
  edits, deletions, or renames of already-committed migration files, and
  blocks duplicate migration numbers. If you need to fix a mistake in a
  migration that's already merged, write a **new** migration — don't touch
  the old file even if it looks like a one-line fix.

- **`schema.sql` must be manually kept in sync with migrations — this is a
  real CI gate, not a suggestion.** There is no generator; you edit both
  files in the same commit. `node scripts/db/verify-migrations.mjs` will
  catch drift (check 5 in §3c) but will not produce the fix for you.
  `supabase/schema/README.md` documents the workflow's ordering rules in
  detail — helper functions must be defined before any policy that calls
  them, and a duplicate `CREATE POLICY` name fails a fresh replay.

- **Expand / migrate / contract for anything destructive.** Never rename or
  drop a column in one migration. Add the new column nullable first
  (expand), backfill and dual-write from the app (migrate), then drop the
  old column in a *later* migration once every deployed app version has
  stopped referencing it (contract) — this is what makes rollback-by-reverting-a-release
  actually safe.

- **Before altering a `CHECK` constraint's value set or a column's
  meaning**, grep every branch site over that column across both apps
  (`carrieros-web` and `carrieros-mobile`). These columns are `TEXT + CHECK`,
  not Postgres enums, so `tsc --noEmit` passing proves nothing about
  exhaustiveness. This is not theoretical — a real bug shipped this way on
  2026-07-22: adding new `profiles.role` values typechecked cleanly, but a
  dashboard page branched over `role` with no fallback case and silently
  rendered blank for the new roles.

- **Large backfills are a separate, batched, resumable step** — never
  inside the same migration that adds the column. One long transaction
  holding locks on a live table is how a routine schema change becomes an
  outage.

### QA: resetting and seeding test data safely

- **Local/staging demo data**: `carrieros-web/scripts/load-demo-data.mjs`
  is the current, rerunnable seeder — idempotent, safe to run repeatedly.
  It ensures the 3 persistent demo accounts exist
  (`demo@carrieros.dev` owner, `mike.driver@carrieros.dev` driver, both on
  "Sierra Freight Co"; `info@shipmentx.com` sx_owner for ShipmentX/SuperAdmin
  testing), plus 4 extra carrier orgs in different billing states
  (trialing-soon-to-expire, past_due/grace-period, high-volume starter tier,
  healthy growth tier) so admin-console screens have realistic variety.
  Run with `--reset` to wipe and re-seed just those 4 extra orgs and their
  child rows (cascades via `ON DELETE CASCADE`).
- **`carrieros-web/scripts/seed-staging-demo.mjs`** is an older, one-shot
  version — it errors on a second run because
  `admin.auth.admin.createUser` rejects an already-registered email. Prefer
  `load-demo-data.mjs` for anything new; this one is kept only because an
  existing staging environment may already depend on its exact behavior.
- **`./scripts/reset-demo.sh`** resets only the 2 persistent local demo
  users' *mutable preferences* (language, units, date/time format) and
  Sierra Freight Co's trial clock back to a fresh 90-day trial — it does
  **not** touch schema, and does **not** touch the 4 extra ShipmentX-admin
  demo orgs (that's `load-demo-data.mjs --reset`'s job). Run this after
  browser-testing changes account preferences, instead of resetting by hand.
- **Do not truncate or drop tables directly against a shared environment.**
  RLS is bypassed entirely by `TRUNCATE` and by the `service_role`/admin
  client — the seed scripts above use the admin client specifically because
  it bypasses RLS and email delivery, which is correct for fixture setup,
  but the same power means a careless direct `psql` session against staging
  can violate tenant isolation invariants no UI would ever let you violate.
  Prefer the seed/reset scripts, or a fresh local `supabase start` +
  `node scripts/db/migrate.mjs` for a throwaway environment, over hand-editing
  a shared database.
- **RLS test scenarios need at least two orgs.** Because the isolation
  boundary is per-`carrier_org_id`, any manual QA pass on "can user X see
  data they shouldn't" needs a second org with its own data to attempt to
  reach — a single-tenant fixture can't exercise the boundary at all. See
  §3b and `carrieros-web/tests/rls-isolation.test.ts` for the shape this
  takes in the automated suite.

## 6. See also

- `architecture/erd.md` — generated entity-relationship diagrams, 6 domain
  sections, regenerate with `node scripts/db/gen-erd.mjs` after any schema
  change.
- `architecture/inventory/database-inventory.md` — point-in-time audit of
  every table's RLS policies, `SECURITY DEFINER` functions, grants, and
  vocabulary/CHECK constraints; the deepest reference for "what exactly
  guards this table."
- `architecture/deployment.md` — full staging deployment process, what
  `deploy.yml` does and doesn't do, and the current manual app-deploy steps.
- `architecture/database-migrations.md` — the canonical migrations workflow
  doc this walkthrough section summarizes; read it directly for the full
  upgrade-an-existing-environment recipe and more detail on expand/migrate/contract.
- `supabase/schema/README.md` — historical context on why `schema.sql` moved
  into version control, and the exact replay recipe for verifying a
  hand-edit before committing it.
