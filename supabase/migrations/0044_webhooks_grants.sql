-- 0044_webhooks_grants.sql
--
-- Same bug as 0043 (which fixed migration 0042's tables), found by the same real-world discovery
-- path: scripts/load-demo-data.mjs, run against staging for the first time, failed with a permission
-- error counting webhooks for an org -- webhooks and webhook_deliveries (migration 0037) got RLS
-- policies but no explicit table-level GRANT, so both were only reachable via Postgres's PUBLIC
-- defaults (REFERENCES, TRIGGER, TRUNCATE -- none of which are SELECT/INSERT/UPDATE/DELETE).
-- 0002_tighten_base_grants.sql already documents the rule this violated: "every NEW table must grant
-- explicitly alongside its RLS policy."
--
-- Confirmed via a direct scan of staging (2026-09-27, same session as 0043): after applying 0043,
-- these were the only two remaining tables in the whole public schema where service_role had zero
-- real (SELECT/INSERT/UPDATE/DELETE) access, and the only two with an RLS policy but no matching
-- authenticated grant. Not a guess -- a full sweep, not just this one script tripping over it.
--
-- Grant shape mirrors each table's actual RLS policy (see 0037's header comments):
--   webhooks: owner/solo read/write their own org's row via a normal session (FOR ALL policy) --
--     authenticated needs SELECT/INSERT/UPDATE/DELETE. service_role needs at least SELECT --
--     SupabaseWebhookDeliveryRepository reads the endpoint URL/secret to know where and how to sign
--     an outbound delivery; it never writes to webhooks itself (that's owner/solo-only via Settings).
--   webhook_deliveries: owner/solo read-only (FOR SELECT policy) -- authenticated needs SELECT only.
--     service_role needs SELECT/INSERT/UPDATE: SupabaseWebhookDeliveryRepository logs each delivery
--     attempt (INSERT) and updates status/attempt_count/last_attempted_at/last_response_status as
--     retries happen (UPDATE) -- no session at all, dispatch is fire-and-forget outside any request.
REVOKE ALL ON webhooks FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhooks TO authenticated;
GRANT SELECT ON webhooks TO service_role;
GRANT USAGE, SELECT ON SEQUENCE webhooks_id_seq TO authenticated;

REVOKE ALL ON webhook_deliveries FROM anon;
GRANT SELECT ON webhook_deliveries TO authenticated;
GRANT SELECT, INSERT, UPDATE ON webhook_deliveries TO service_role;
GRANT USAGE, SELECT ON SEQUENCE webhook_deliveries_id_seq TO service_role;
