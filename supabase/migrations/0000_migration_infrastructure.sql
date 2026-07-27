-- 0000_migration_infrastructure.sql
-- Migration bookkeeping. Must be the first migration applied to any database.
--
-- Until 2026-07-26 this repo had no migrations at all: schema changes were
-- applied ad hoc with psql and then hand-written into supabase/schema/schema.sql
-- (see supabase/schema/README.md). That made schema.sql the only record of
-- intent, with no ordering, no record of what a given environment had actually
-- received, and no way to upgrade an existing database — only to rebuild one.
--
-- From here, supabase/migrations/*.sql is the AUTHORITY for schema evolution and
-- schema.sql becomes a generated current-state snapshot used for review and
-- drift detection. See architecture/database-migrations.md.

CREATE TABLE IF NOT EXISTS schema_migrations (
  -- Zero-padded ordinal parsed from the filename (0000, 0001, ...). Ordering is
  -- by this column, never by applied_at: two migrations applied in the same
  -- transaction share a timestamp, and clock skew between environments must
  -- never be able to reorder schema history.
  version      TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  -- SHA-256 of the file's bytes at apply time. The runner refuses to proceed if
  -- an already-applied migration's checksum no longer matches, which is what
  -- makes "immutable once merged" an enforced property rather than a convention.
  checksum     TEXT NOT NULL,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Wall-clock duration, for spotting migrations that will need a maintenance
  -- window as data volume grows.
  duration_ms  INTEGER
);

COMMENT ON TABLE schema_migrations IS
  'Applied schema migrations. Written only by scripts/db/migrate.mjs. Ordered by version, never by applied_at.';

-- This table is infrastructure, not tenant data. It is deliberately NOT granted
-- to `authenticated` or `anon`: no application user has any reason to read
-- schema history, and leaking it discloses the shape and timing of internal
-- changes. RLS is enabled with no policy, so even if a future blanket GRANT
-- sweeps it up (SECTION 8c of the baseline does exactly that for public tables),
-- non-superuser access still yields zero rows.
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON schema_migrations FROM PUBLIC;
