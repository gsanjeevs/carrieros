# Database migrations

`supabase/migrations/*.sql` is the **authority** for schema evolution.
`supabase/schema/schema.sql` is a reviewed current-state **snapshot**, verified
against the migrations on every run of the checker — it is no longer the thing
you edit to change the database.

## Why this replaced the old workflow

Until 2026-07-26 there were no migrations. Changes were applied ad hoc with
`psql` and then hand-copied into `schema.sql`. That workflow has three failure
modes, and the audit found all three had already occurred or were latent:

- **Silent drift.** `profiles.users_read_own_profile` existed in the running
  database but had never been written into `schema.sql`. The system behaved
  correctly; the loss would only appear on the next `db reset`, as an auth bug
  far from its cause. (Recovered in `0004`.)
- **No upgrade path.** `schema.sql` can *create* a database. It cannot upgrade
  one, because it does not know what the target already has.
- **No record of what an environment received.** Two environments could claim
  the same schema and differ.

## Commands

```bash
node scripts/db/migrate.mjs              # apply pending migrations
node scripts/db/migrate.mjs --status     # what is applied vs pending
node scripts/db/migrate.mjs --dry-run    # list without applying
node scripts/db/verify-migrations.mjs    # 9 checks in throwaway databases
```

Target selection: `--database <name>`, or `PG_CONTAINER` for a different
container, or `DATABASE_URL` to bypass Docker and use `psql` directly.

## Creating a new database

```bash
node scripts/db/migrate.mjs
```
`0000` bootstraps `schema_migrations`; `0001` lays down the baseline; later
migrations apply in numeric order. Each migration runs in **one transaction
together with its bookkeeping row**, so a failure leaves nothing half-applied.

## Upgrading an existing environment

An environment created before migrations existed already has the `0001` schema
and must **not** re-run it. Adopt it, then move forward:

```bash
# 1. install bookkeeping
docker exec -i supabase_db_carrieros psql -U postgres -d postgres \
  < supabase/migrations/0000_migration_infrastructure.sql

# 2. record 0000 and 0001 as already-present, with their REAL checksums
#    (a placeholder value will fail the immutability check on the next run)
for f in 0000_migration_infrastructure 0001_baseline_schema; do
  sum=$(shasum -a 256 "supabase/migrations/$f.sql" | cut -d' ' -f1)
  docker exec supabase_db_carrieros psql -U postgres -d postgres -c \
    "insert into schema_migrations(version,name,checksum)
     values ('${f%%_*}','${f#*_}','$sum') on conflict do nothing;"
done

# 3. apply everything after the baseline
node scripts/db/migrate.mjs
```

This exact path is exercised by the verifier's *"an existing database baselined
at 0001 can upgrade to head"* check, which asserts the upgraded database is
**fingerprint-identical** to one built fresh from migrations.

## How migration state is detected

`schema_migrations` holds `version`, `name`, `checksum` (SHA-256 of the file at
apply time), `applied_at` and `duration_ms`. Ordering is always by `version`,
never `applied_at` — two migrations in one transaction share a timestamp, and
clock skew must never be able to reorder history.

**Immutability is enforced, not requested.** Every run re-hashes applied files
and refuses to continue if one changed. Editing a merged migration is the
commonest way environments end up claiming the same version with different
schemas; the runner makes it impossible to do quietly. **Fix forward.**

## Expand / migrate / contract

Never rename or drop in one step. For a column rename:

1. **Expand** — add the new column, nullable, no default that rewrites the table.
2. **Migrate** — backfill in batches; dual-write from the application; make the
   new column authoritative once reads are switched.
3. **Contract** — drop the old column in a *later* migration, after every
   deployed version has stopped referencing it.

The steps must be separate migrations, because a rollback of step 3 is a data
loss event whereas a rollback of step 1 is free.

**Before altering a `CHECK` constraint's value set or a column's meaning**,
follow the existing rule in `supabase/schema/README.md`: grep every branch site
across both apps. These are `TEXT + CHECK`, not Postgres enums, so generated
types are plain `string` and `tsc` proves nothing about exhaustiveness. That is
exactly how a 2026-07-22 bug shipped a blank dashboard for new roles.

## Backfills

Large backfills do not belong inside the schema migration that adds the column —
one long transaction holding locks is how a deploy becomes an outage. Add the
column in a migration; run the backfill as a separate, batched, resumable,
idempotent step; then add the constraint in a third migration once data is clean.

## Rollback and forward recovery

**There are no `down` migrations, deliberately.** A `down` that has never been
run in anger is a false promise, and for anything destructive it cannot restore
data it dropped. Recovery is:

1. **Roll back the application** to the prior release (schema changes must be
   backward-compatible for one release — that is what expand/contract buys).
2. **Fix forward** with a new migration.
3. **Restore from backup** only for genuine data loss, as a deliberate
   operational decision.

This is why destructive changes are kept out of the baseline and split across
releases: the window in which a rollback is free must be as wide as possible.

## CI

`node scripts/db/verify-migrations.mjs` is the gate. It builds throwaway
databases (prefix `migrationcheck_`, and it refuses to drop anything not so
prefixed), asserts the 9 properties listed above, and drops them. It touches no
real database and applies nothing to production.
