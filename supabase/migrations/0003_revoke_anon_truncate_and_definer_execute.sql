-- 0003_revoke_anon_truncate_and_definer_execute.sql
-- Two privilege findings from the 2026-07-26 baseline audit
-- (architecture/inventory/database-inventory.md). Both are grant-layer issues,
-- so neither is visible in RLS policy review — which is precisely why they
-- survived: every policy was correct.

-- ── 1. `anon` holds TRUNCATE on all 40 public tables ────────────────────────
-- Inherited from the baseline's blanket grant plus Supabase's role setup.
-- TRUNCATE is not filtered by row-level security: a policy that restricts
-- DELETE to your own org does nothing to stop TRUNCATE emptying the table.
--
-- Not currently reachable — PostgREST exposes no TRUNCATE verb, so this needs
-- a direct SQL connection as `anon` to exploit. That makes it a latent hazard
-- rather than an open door, and it is exactly the kind of privilege that
-- should not be sitting there waiting for a connection-string mistake or a
-- future feature that proxies SQL. Removing it costs nothing: no application
-- code path truncates anything.
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon', t.relname);
    -- `authenticated` has no business truncating tenant data either. Ordinary
    -- deletes remain governed by RLS as before.
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM authenticated', t.relname);
  END LOOP;
END $$;

-- ── 2. SECURITY DEFINER functions with default PUBLIC execute ───────────────
-- `create_customer_org` and `bulk_import_customers` run as their owner
-- (postgres), bypassing RLS by design, and were never granted explicitly — so
-- they carry PostgreSQL's default EXECUTE TO PUBLIC. PUBLIC includes `anon`,
-- meaning an unauthenticated PostgREST caller can invoke them. Their only
-- protection is an in-body check that raises if the caller has no org.
--
-- Depending on a function body's own guard is single-layer defence of exactly
-- the kind this modernization is meant to remove: the guard and the grant
-- should fail independently. Every other SECURITY DEFINER function here is
-- already `authenticated`-only (verified: has_feature, check_ifta_completeness
-- and the rest show `authenticated=X/postgres`); these two are the outliers.
--
-- Scoped to the exact signatures so this fails loudly if a signature changes,
-- rather than silently matching nothing.
REVOKE EXECUTE ON FUNCTION public.create_customer_org(
  text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_org(
  text, text, text, text, text, text, text, text, text, text
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.bulk_import_customers(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_import_customers(jsonb) TO authenticated;

-- Deliberately NOT addressed here, and tracked in the baseline document
-- instead, because each is a behaviour change rather than a privilege
-- correction and needs its own migration plus application changes:
--
--   * check_ifta_completeness(p_load_id bigint) performs no tenant check, so
--     any authenticated user can pass an arbitrary load id and learn about
--     another carrier's IFTA data. Fixing it means adding a carrier_org_id
--     predicate, which changes results for any caller currently relying on
--     the unscoped behaviour — that needs the call sites migrated first.
--   * `loads_driver_view` carries INSERT/UPDATE/DELETE grants that a view of
--     that shape cannot honour.
