-- 0046_webhooks_seq_service_role.sql
--
-- Second follow-up to 0044/0045: 0045 gave service_role INSERT/UPDATE/DELETE on webhooks itself, but
-- missed that a BIGSERIAL INSERT also needs USAGE+SELECT on the backing sequence (a separate
-- grantable object, same gap 0043 already called out for telematics_integrations/vehicle_locations).
-- Confirmed live on staging (2026-09-27, same fix cycle as 0043/0044/0045): re-running
-- scripts/load-demo-data.mjs after 0045 got past the table-permission error but then failed with
-- "permission denied for sequence webhooks_id_seq".
GRANT USAGE, SELECT ON SEQUENCE webhooks_id_seq TO service_role;
