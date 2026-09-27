-- 0043_telematics_grants.sql
--
-- Fixes a real bug in migration 0042: telematics_integrations and vehicle_locations got RLS
-- policies but no explicit table-level GRANT, so both tables were only reachable via whatever
-- Postgres hands out to PUBLIC by default (REFERENCES, TRIGGER, TRUNCATE, MAINTAIN -- none of which
-- are SELECT/INSERT/UPDATE/DELETE). 0042's own comment said "service_role bypasses RLS by default,
-- no extra grant needed" -- true for RLS specifically, but RLS and base table grants are separate
-- Postgres permission layers; bypassing RLS does not imply having a grant to touch the table at all.
-- 0002_tighten_base_grants.sql already spells out the consequence of removing the old blanket grant:
-- "every NEW table must grant explicitly alongside its RLS policy." 0042 missed that.
--
-- Confirmed live on staging (2026-09-27): scripts/load-demo-data.mjs, run against the real hosted
-- staging project for the first time, failed with "permission denied for table vehicle_locations"
-- on a plain service-role INSERT. Local dev never surfaced this -- the local Supabase CLI stack's
-- default role privileges are more permissive than a real hosted project's, which is exactly why
-- this class of bug needs a real environment to catch, not just local testing.
--
-- Grant shape mirrors each table's actual RLS policy, not a blanket ALL:
--   telematics_integrations: owner/solo read/write their own org's row via a normal session (FOR ALL
--     policy) -- authenticated needs SELECT/INSERT/UPDATE/DELETE. service_role needs the same for the
--     Samsara poller and Motive webhook receiver, which read/write with no user session at all.
--   vehicle_locations: any org member can read (SELECT-only policy); ALL writes come from the
--     service-role admin client (poller/webhook, no user session) per 0042's own documented design
--     -- authenticated only needs SELECT, service_role needs SELECT/INSERT (no UPDATE/DELETE --
--     nothing in the app ever mutates or removes a location ping once written).
REVOKE ALL ON telematics_integrations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON telematics_integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON telematics_integrations TO service_role;

REVOKE ALL ON vehicle_locations FROM anon;
GRANT SELECT ON vehicle_locations TO authenticated;
GRANT SELECT, INSERT ON vehicle_locations TO service_role;

-- BIGSERIAL primary keys need USAGE+SELECT on their backing sequence for INSERT ... RETURNING (and
-- plain INSERT) to work at all -- the sequence is a separate grantable object from the table itself,
-- and 0042 never granted this either (same PUBLIC-only-default gap as the tables above).
GRANT USAGE, SELECT ON SEQUENCE telematics_integrations_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE vehicle_locations_id_seq TO service_role;
