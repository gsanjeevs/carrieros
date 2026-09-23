-- 0028_admin_support_capability.sql
--
-- Fix-forward on migration 0027 (support_tickets, decisions.md T16) -- immutability rule means the
-- fix landed as its own migration rather than an in-place edit, even though 0027 had at this point
-- only ever been applied on local dev machines, never pushed to origin/staging/production.
--
-- Who may staff ShipmentX's own carrieros_support queue: sx_owner/sx_support only, matching 0027's own
-- RLS policies (sx_carrieros_support_select/_update are explicitly NOT granted to sx_finance). The
-- app/api/admin/support-tickets/** routes use the service-role admin client, which bypasses RLS
-- entirely -- so requireAdminRole()'s own capability check IS the real enforcement point for those
-- routes, not the RLS policies (those are defense in depth per 0027's own comments). Without a
-- dedicated capability here, those routes defaulted to requireAdminRole(request)'s bare 'admin'
-- capability, which sx_finance also holds -- letting finance staff read/reply to product support
-- tickets, contradicting 0027's own RLS policies. Caught in review before this ever reached a shared
-- environment.
INSERT INTO role_capabilities (role, capability) VALUES
  ('sx_owner',   'admin_support'),
  ('sx_support', 'admin_support');
