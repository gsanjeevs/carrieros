# supabase/schema

`schema.sql` is the source of truth for the database. It is version-controlled
**here**, in the repo.

## Why it lives here now

It used to live only at `docs/carrieros-db/schema.sql` — and `docs/` is a
symlink to an external Zoho WorkDrive folder that is gitignored. That meant the
schema, including every RLS policy, had no version history and existed in
exactly two places: one laptop's Postgres container and one cloud drive.

On 2026-07-20 an audit found five critical security holes (among them a view
that bypassed RLS entirely, letting any driver read and write every carrier's
loads). Those fixes are policy text. Losing the file loses the fixes, silently,
with no diff to review and no way to tell when a policy changed or why. That
risk is not acceptable for the file that defines who can read what.

## Workflow

There is still no `supabase/migrations/` directory — schema changes are applied
ad hoc, then written into this file:

1. Apply the change to the local DB:
   `docker exec -i supabase_db_carrieros psql -U postgres -d postgres < your.sql`
2. Edit `schema.sql` here to match, **in place** — put each policy next to the
   table it guards, not appended at the end. A duplicate `CREATE POLICY` name
   fails on a fresh run.
3. **If this change alters a `CHECK` constraint's value set or a column's
   meaning** (adding a new nullable column or a new table is low-risk and
   skips this step): grep every branch site over that column across both
   apps — `grep -rn "columnName" carrieros-web/app carrieros-web/lib
   carrieros-web/components carrieros-mobile/src` — and confirm each site
   either has a safe fallback/exhaustive handling or gets updated as part of
   this same change. `tsc --noEmit` passing does NOT prove this: these
   columns are `TEXT + CHECK`, not Postgres enum types, so Supabase's
   generated types are plain `string` with no compiler-level exhaustiveness
   check. This is exactly the manual check that caught a real bug
   (2026-07-22): adding `sx_owner`/`sx_finance`/`sx_support` to
   `profiles.role` typechecked fine, but `dashboard/page.tsx` branched over
   `profile.role` with no fallback case, silently rendering a blank page for
   the new roles. See `docs/architecture-principles.md` (Rule E) for the
   full reasoning.
4. Regenerate types: `./scripts/regen-types.sh`, then `npx tsc --noEmit` in both
   apps.
5. Commit `schema.sql` with the code that depends on it.

## Ordering matters

The file is executed top to bottom. A policy that calls a helper
(`my_org_id()`, `my_role()`, `driver_self_update_allowed()`) must appear
**after** that function is defined. This has already bitten once: an
`org_sequences` policy was written at line ~310 while `my_org_id()` is defined
at ~480, which would have failed on the next `db reset`.

## Verifying a change before you commit it

Replay the whole file against a scratch database — this catches ordering bugs,
typos, and duplicate policy names that a live incremental `psql` never will:

```sh
docker exec supabase_db_carrieros psql -U postgres -d postgres \
  -c "drop database if exists schema_test;" -c "create database schema_test;"

# stub the Supabase-managed objects the schema references
docker exec -i supabase_db_carrieros psql -U postgres -d schema_test <<'SQL'
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, metadata jsonb);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
SQL

docker exec -i supabase_db_carrieros psql -U postgres -d schema_test -v ON_ERROR_STOP=0 \
  < supabase/schema/schema.sql 2>&1 | grep -c '^ERROR'   # must print 0

docker exec supabase_db_carrieros psql -U postgres -d postgres -c "drop database schema_test;"
```

As of 2026-07-21 (post-Phase 7B-7F) a clean replay yields 0 errors, 35 tables, 80 policies.

## After every `supabase db reset`

Re-run this file — that's it. `schema.sql` now ends with a blanket
`GRANT ... ON ALL TABLES IN SCHEMA public TO authenticated, service_role`
(SECTION 8c), so it's self-sufficient on a fresh reset.

**History (2026-07-21):** this used to say "then the GRANT statements noted
at the top of it" — but no such statements ever actually existed anywhere in
this file or the repo; it was tribal knowledge for a manual step someone ran
once, undocumented. That silently bit a fresh batch of tables added
2026-07-21 (`vehicle_types`, `tiers`, `features`, etc.): their RLS policies
were correct, but `authenticated` had no base SELECT grant at all, so queries
returned zero rows with no error — indistinguishable from an empty table
until traced with `\dp`. SECTION 8c's blanket GRANT closes this permanently;
a future new table just needs `ENABLE ROW LEVEL SECURITY` + its policy, the
base grant is already covered.

## The Zoho copy

`docs/carrieros-db/schema.sql` still exists so the product docs stay
self-contained. **This file is authoritative.** If they disagree, this one wins.
