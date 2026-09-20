-- 0009_role_capabilities.sql
--
-- Single source of truth for role -> capability gating, consumed identically
-- by carrieros-web (proxy.ts's ROLE_ROUTES, lib/roles-policy.ts) and
-- carrieros-mobile (src/constants/tab-sets.ts). Before this migration, both
-- apps hand-duplicated their own "which role can do X" arrays with zero
-- shared source -- a real drift already happened once (BILLING_ROLES was
-- ['owner','solo','finance'] in five web files and ['owner','solo'] in two
-- others), and mobile has no equivalent shared file at all, so it would
-- duplicate independently the next time this kind of rule changes.
--
-- This is NOT a security boundary -- RLS policies on the actual data tables
-- remain the real enforcement (a driver cannot query another driver's loads
-- regardless of what this table says). role_capabilities only drives
-- navigation/UI gating: which routes (web) or tabs (mobile) a role sees.
-- Getting a row wrong here means a confusing redirect, not a data leak.
--
-- Consumption pattern: this table is NOT queried live per-request (web's
-- proxy.ts runs on the Edge for every request; an extra DB round-trip there
-- would add real latency). Instead, `scripts/gen-role-capabilities.mjs`
-- reads this table once (same idea as scripts/regen-types.sh generating TS
-- types from the schema) and writes an identical generated constants file
-- into both apps. Adding or changing a capability means: new migration ->
-- apply -> re-run the generator -> both apps update from the same source,
-- instead of a human editing two hand-written arrays and hoping they match.
--
-- Presence of a (role, capability) row = allowed. Absence = denied (no
-- explicit `allowed boolean` column -- a missing row IS the "no" case,
-- avoiding a second way to express the same thing).

CREATE TABLE role_capabilities (
  role       TEXT NOT NULL REFERENCES roles(code),
  capability TEXT NOT NULL,
  PRIMARY KEY (role, capability)
);

COMMENT ON TABLE role_capabilities IS
  'Role -> capability gating, single-sourced for web + mobile via scripts/gen-role-capabilities.mjs. UI/navigation gating only, not a security boundary -- see migration 0009 header comment.';

-- Seeded to exactly match pre-migration behavior (proxy.ts's ROLE_ROUTES /
-- ROLE_HOME and lib/roles-policy.ts's INVOICE_ROLES / SUBSCRIPTION_ROLES) --
-- this migration centralizes the existing rules, it does not change access
-- for anyone. customer_admin / customer_viewer intentionally get no rows:
-- today's code has no defined behavior for them either (a known, separately
-- tracked gap -- see architecture-principles.md), so "denied by default" is
-- the honest current state, not a regression.
INSERT INTO role_capabilities (role, capability) VALUES
  ('owner',      'dashboard'),
  ('owner',      'dispatch'),
  ('owner',      'finance'),
  ('owner',      'my_loads'),
  ('owner',      'drivers'),
  ('owner',      'team'),
  ('owner',      'invoice_actions'),
  ('owner',      'subscription_management'),

  ('solo',       'dashboard'),
  ('solo',       'dispatch'),
  ('solo',       'finance'),
  ('solo',       'my_loads'),
  ('solo',       'drivers'),
  ('solo',       'team'),
  ('solo',       'invoice_actions'),
  ('solo',       'subscription_management'),

  ('dispatcher', 'dashboard'),
  ('dispatcher', 'dispatch'),
  ('dispatcher', 'drivers'),

  ('finance',    'dashboard'),
  ('finance',    'finance'),
  ('finance',    'invoice_actions'),

  ('driver',     'dashboard'),
  ('driver',     'my_loads'),

  ('sx_owner',   'admin'),
  ('sx_finance', 'admin'),
  ('sx_support', 'admin');

ALTER TABLE role_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_capabilities_select" ON role_capabilities FOR SELECT TO authenticated USING (true);

-- Same closed-set / read-only-reference-data posture as roles, languages,
-- vehicle_types, etc. (schema.sql SECTION "GLOBAL MASTER DATA") -- changed
-- only via a new migration + regenerating both apps' constants file, never
-- app-writable.
REVOKE INSERT, UPDATE, DELETE ON role_capabilities FROM authenticated;
GRANT SELECT ON role_capabilities TO authenticated;
