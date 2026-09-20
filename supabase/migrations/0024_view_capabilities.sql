-- 0024_view_capabilities.sql
--
-- Finishes what 0023 started. 0023 single-sourced the ACTION gates (services, API routes, admin console).
-- What it could not express was the other half of the role rules: which surfaces a role may LOOK at, and
-- whether it may see money. Those stayed as hand-written arrays in the sidebar and in ~8 page guards,
-- because no capability's role set matched their meaning -- e.g. {owner,solo,dispatcher} is shared by
-- `dispatch` and `loads_manage`, but neither means "the exception queue", and picking one by set equality
-- would couple an unrelated surface to it. Inventing the missing capabilities is the honest fix.
--
-- Seeded from the literals they replace, so every role sees exactly the surfaces it saw before.
--
-- `rate_visibility` is the one with teeth beyond navigation: decisions.md BR-1 says a driver must never see
-- a load's commercial rate, and that rule was written out by hand in three separate page guards
-- (loads/drivers/vehicles detail, plus customer revenue). It also has a database counterpart, the
-- loads_driver_view that omits the rate column, so a single named capability is what lets the two stay
-- recognisably the same rule. RLS remains the enforcement boundary; this governs what the UI renders.

INSERT INTO role_capabilities (role, capability) VALUES
  -- Surfaces. Finance sees loads and customers because it bills against them, but it does not dispatch,
  -- which is why these are not the same rows as `dispatch` / `loads_manage`.
  ('owner', 'loads_view'), ('solo', 'loads_view'), ('dispatcher', 'loads_view'), ('finance', 'loads_view'),
  ('owner', 'customers_view'), ('solo', 'customers_view'), ('dispatcher', 'customers_view'), ('finance', 'customers_view'),
  ('owner', 'exceptions_view'), ('solo', 'exceptions_view'), ('dispatcher', 'exceptions_view'),
  ('owner', 'maintenance_view'), ('solo', 'maintenance_view'), ('dispatcher', 'maintenance_view'),
  -- A driver reads their OWN settlements here (RLS scopes the rows); the office roles read the org's.
  ('owner', 'settlements_view'), ('solo', 'settlements_view'), ('finance', 'settlements_view'), ('driver', 'settlements_view'),
  -- Everyone has account settings; the row exists so the sidebar holds no literal at all.
  ('owner', 'settings_view'), ('solo', 'settings_view'), ('dispatcher', 'settings_view'), ('finance', 'settings_view'), ('driver', 'settings_view'),

  -- The carrier's own compliance paperwork (COI, MC authority, UCR) -- distinct from `documents_read`,
  -- which is load paperwork and includes dispatcher and driver.
  ('owner', 'org_documents_view'), ('solo', 'org_documents_view'), ('finance', 'org_documents_view'),
  ('owner', 'org_documents_manage'), ('solo', 'org_documents_manage'),
  -- Removing a document already attached to a load.
  ('owner', 'documents_delete'), ('solo', 'documents_delete'),

  -- Money on screen: rates, revenue, margins (decisions.md BR-1).
  ('owner', 'rate_visibility'), ('solo', 'rate_visibility'), ('finance', 'rate_visibility');
