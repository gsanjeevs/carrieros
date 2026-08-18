-- 0008_grant_service_role_outbox_audit.sql
-- Fixes a gap in 0005: outbox_events and audit_events got RLS and
-- anon/authenticated grants, but `service_role` itself was never granted any
-- privileges on either table. In self-hosted Supabase, service_role bypasses
-- RLS but NOT plain table grants — GRANT and RLS are orthogonal. With no
-- explicit grant, service_role's actual privileges on a freshly created
-- table are none, same as any other role.
--
-- Practical effect until now: nothing running as service_role — a background
-- worker draining the outbox, an admin route reading the audit log, or (how
-- this was actually found) the test suite's admin client verifying
-- submit_shipment_milestone's writes — could read outbox_events or
-- audit_events at all. The write path itself worked, because
-- submit_shipment_milestone (0006/0007) runs SECURITY DEFINER as the table
-- owner, not as service_role.
--
-- Scope of the grant: SELECT + UPDATE on outbox_events (a worker needs to
-- read pending rows and mark them processed/failed; it never INSERTs — that
-- stays exclusive to the SECURITY DEFINER command functions, so no INSERT
-- grant here). SELECT only on audit_events (read-only log; INSERT stays
-- exclusive to the command functions and to `authenticated`'s own-org insert
-- policy from 0005).

GRANT SELECT, UPDATE ON outbox_events TO service_role;
GRANT SELECT ON audit_events TO service_role;
