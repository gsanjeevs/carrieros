-- 0023_action_capabilities.sql
--
-- Makes role_capabilities the single source of truth for role gating, not just for navigation.
--
-- 0009 introduced the table for UI/navigation gating only (9 page-level capabilities: dashboard, dispatch,
-- team, ...) and said so explicitly: "NOT a security boundary". Meanwhile the ACTUAL role decisions kept
-- living in hand-written arrays: the 2026-09-20 roles audit counted 68 of them across web and mobile
-- (13 `MAY_*` sets in server/application/*.ts, ~20 route-level arrays, plus UI copies), and found that
-- `role_capabilities` therefore was not the single source it claimed to be. That is how the app layer and
-- the RLS policies drifted apart in the first place (audit findings 4, 5, 9 and 13: commands whose RPC
-- allowed more than the service did).
--
-- This migration seeds the action-level capabilities those arrays encode, so the arrays can be deleted and
-- every layer reads one table. Seeded to reproduce today's access EXACTLY -- this centralizes the existing
-- rules, it does not grant or revoke anything for anyone. Each row below names the code it replaces.
--
-- STATUS CHANGE: role_capabilities is now an authorization input at the API layer, not merely UI gating.
-- RLS remains the enforcement backstop beneath it (a wrong row here is now a real access bug, not just a
-- confusing redirect), which is why the table comment is rewritten below. The two layers are held together
-- by the black-box probes in tests/security-*.test.ts, which exercise real sessions through both.
--
-- Consumption is unchanged: `node scripts/gen-role-capabilities.mjs` reads this table and writes the
-- identical generated constants file into both apps. Nothing queries it per request.
--
-- Naming: snake_case, `<area>_<action>`, matching the existing rows. Presence = allowed, absence = denied.
-- `invoice_actions` (0009) already expresses "may manage invoices" for owner/solo/finance and is reused by
-- InvoiceService rather than adding a second capability that means the same thing.

INSERT INTO role_capabilities (role, capability) VALUES
  -- Loads. `loads_manage` = create/edit/assign (app/api/loads/route.ts, loads/[id]/route.ts, DISPATCH_ROLES).
  -- `loads_advance_status` additionally includes the driver, who advances their own load's milestones
  -- (ShipmentMilestoneService.MAY_ADVANCE); which load they may touch stays with authorizeLoadAction.
  ('owner', 'loads_manage'), ('solo', 'loads_manage'), ('dispatcher', 'loads_manage'),
  ('owner', 'loads_advance_status'), ('solo', 'loads_advance_status'), ('dispatcher', 'loads_advance_status'), ('driver', 'loads_advance_status'),
  -- Paid LLM intake extraction (app/api/extract-load/route.ts, role gate added by the same audit).
  ('owner', 'load_intake_extract'), ('solo', 'load_intake_extract'), ('dispatcher', 'load_intake_extract'),

  -- Documents. upload = DocumentService.MAY_UPLOAD, read = MAY_READ (finance sees paperwork it must bill
  -- against), send = SEND_ROLES in loads/[id]/send-documents.
  ('owner', 'documents_upload'), ('solo', 'documents_upload'), ('dispatcher', 'documents_upload'), ('driver', 'documents_upload'),
  ('owner', 'documents_read'), ('solo', 'documents_read'), ('dispatcher', 'documents_read'), ('finance', 'documents_read'), ('driver', 'documents_read'),
  ('owner', 'documents_send'), ('solo', 'documents_send'), ('dispatcher', 'documents_send'),

  -- Customers and their portal contacts (app/api/customers/**).
  ('owner', 'customers_manage'), ('solo', 'customers_manage'), ('dispatcher', 'customers_manage'),

  -- Field actions performed from the truck, mirrored by the office roles that also do them on a driver's
  -- behalf (DriverActionService, FieldActionsService, IftaService, DvirService).
  ('owner', 'fuel_log'), ('solo', 'fuel_log'), ('dispatcher', 'fuel_log'), ('driver', 'fuel_log'),
  ('owner', 'problem_report'), ('solo', 'problem_report'), ('driver', 'problem_report'),
  ('owner', 'chat_participate'), ('solo', 'chat_participate'), ('dispatcher', 'chat_participate'), ('driver', 'chat_participate'),
  ('owner', 'location_share'), ('solo', 'location_share'), ('driver', 'location_share'),
  ('owner', 'ifta_record'), ('solo', 'ifta_record'), ('dispatcher', 'ifta_record'), ('driver', 'ifta_record'),
  ('owner', 'dvir_file'), ('solo', 'dvir_file'), ('driver', 'dvir_file'),
  -- Attaching to SOMEONE ELSE'S inspection; a driver may still attach to their own (DvirService).
  ('owner', 'dvir_attach_any'), ('solo', 'dvir_attach_any'),
  -- A driver edits their own driver record; 'solo' is owner+driver combined, so it is here too.
  ('driver', 'driver_profile_edit_own'), ('solo', 'driver_profile_edit_own'),

  -- Fleet and money.
  ('owner', 'service_log'), ('solo', 'service_log'),
  ('owner', 'settlements_manage'), ('solo', 'settlements_manage'), ('finance', 'settlements_manage'),

  -- Org administration (team/route.ts + team/[id] ADMIN_ROLES, drivers/invite, vehicles).
  ('owner', 'team_manage'), ('solo', 'team_manage'),
  ('owner', 'drivers_manage'), ('solo', 'drivers_manage'),
  ('owner', 'vehicles_manage'), ('solo', 'vehicles_manage'),

  -- ShipmentX platform staff. The existing `admin` row is console access; these split it by what the
  -- individual admin routes already require, so sx_support cannot be widened by accident.
  ('sx_owner', 'admin_billing'), ('sx_finance', 'admin_billing'),
  ('sx_owner', 'admin_flags'),
  ('sx_owner', 'admin_impersonate'), ('sx_support', 'admin_impersonate');

COMMENT ON TABLE role_capabilities IS
  'Role -> capability, the single source of truth for role gating in both apps, generated into each by scripts/gen-role-capabilities.mjs. Since 0023 this is an authorization input at the API layer (services and routes), not only navigation gating; RLS on the data tables remains the enforcement backstop beneath it. Presence of a row = allowed, absence = denied.';
