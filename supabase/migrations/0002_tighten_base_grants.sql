-- 0002_tighten_base_grants.sql
-- Defence in depth for base-table privileges.
--
-- WHY. The baseline ends with (SECTION 8c):
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
--     TO authenticated, service_role;
-- That statement exists for a good reason — it fixed a real 2026-07-21 bug
-- where correct RLS policies returned zero rows because the base grant was
-- missing — but it is far wider than that fix needed. It hands every
-- authenticated user INSERT/UPDATE/DELETE on EVERY table that exists at replay
-- time, including read-only reference catalogs and internal infrastructure.
--
-- Nothing is currently exploitable through it, because those tables' RLS
-- policies define SELECT only and RLS denies unlisted commands by default. That
-- is exactly the problem: RLS is left as the ONLY control standing between an
-- authenticated user and `DELETE FROM tiers`. One permissive policy added later
-- by someone who assumes the grant layer is restrictive turns into data loss.
-- Grants and RLS should fail independently.
--
-- WHAT THIS DOES NOT DO. It does not revoke anything from tenant-data tables
-- (loads, invoices, drivers, ...). Those legitimately need write access through
-- RLS, and narrowing them belongs with the per-table repository work, not in a
-- blanket sweep. This migration only removes privileges that no application
-- code path uses, so it is safe to apply to a running environment.

-- ── Reference catalogs: readable by everyone, writable by nobody ────────────
-- These hold product/reference data (plan tiers, feature definitions, locale
-- list, IFTA tax rates, vehicle taxonomies, platform flags). They are written
-- only by migrations and platform operators, never by an end user's session.
DO $$
DECLARE
  catalog_table TEXT;
BEGIN
  FOREACH catalog_table IN ARRAY ARRAY[
    'tiers',
    'features',
    'languages',
    'ifta_tax_rates',
    'roles',
    'vehicle_types',
    'vehicle_classifications',
    'vehicle_type_classifications',
    'platform_flags'
  ] LOOP
    -- to_regclass keeps this migration idempotent and tolerant of an
    -- environment that predates one of these tables.
    IF to_regclass('public.' || catalog_table) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated', catalog_table);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', catalog_table);
    END IF;
  END LOOP;
END $$;

-- ── Migration bookkeeping is not application data ───────────────────────────
-- 0000 revokes this, but 0000 runs BEFORE the baseline on a fresh database, so
-- SECTION 8c's blanket grant re-exposes it moments later. Re-revoking here is
-- what makes a freshly-created database converge with an upgraded one, and it
-- is how the migration verifier caught the blanket grant's reach in the first
-- place.
REVOKE ALL ON public.schema_migrations FROM authenticated, anon;

-- ── Safe defaults for objects created from here on ──────────────────────────
-- Postgres's built-in default is already "no privileges to authenticated", and
-- there is deliberately no ALTER DEFAULT PRIVILEGES ... GRANT here: adding one
-- would recreate the auto-exposure this migration exists to prevent. Stating it
-- explicitly so the absence reads as a decision rather than an oversight.
--
-- The consequence is that every NEW table must grant explicitly alongside its
-- RLS policy. That is the trade the 2026-07-21 bug argued against, but the
-- answer to "someone will forget the grant" is a test, not a blanket grant —
-- see the grants assertion in scripts/db/verify-migrations.mjs and the RLS
-- matrix tests. A forgotten grant should fail loudly in CI, not be papered over
-- by handing out DELETE on everything.

COMMENT ON TABLE public.schema_migrations IS
  'Applied schema migrations. Written only by scripts/db/migrate.mjs. Not application-readable (see 0002).';
