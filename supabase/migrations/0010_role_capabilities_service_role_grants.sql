-- 0010_role_capabilities_service_role_grants.sql
-- 0009 created role_capabilities but granted service_role nothing, while the
-- schema.sql snapshot's blanket grant (SECTION 8c) gives service_role full
-- table privileges on every table -- the convention 0002 narrowed only for
-- `authenticated`. verify-migrations.mjs caught the drift. Fixed forward
-- (0009 was already applied) by matching the snapshot/convention.
-- Also needed in practice: scripts/gen-role-capabilities.mjs and admin
-- tooling run as service_role.

GRANT SELECT, INSERT, UPDATE, DELETE ON role_capabilities TO service_role;
