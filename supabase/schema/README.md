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
3. Regenerate types: `./scripts/regen-types.sh`, then `npx tsc --noEmit` in both
   apps.
4. Commit `schema.sql` with the code that depends on it.

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

As of 2026-07-20 a clean replay yields 0 errors, 18 tables, 59 policies.

## After every `supabase db reset`

Re-run this file, then the GRANT statements noted at the top of it. Local
Supabase does not auto-grant table privileges to `authenticated`/`service_role`.

## The Zoho copy

`docs/carrieros-db/schema.sql` still exists so the product docs stay
self-contained. **This file is authoritative.** If they disagree, this one wins.
