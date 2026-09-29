-- ============================================================
-- CarrierOS — Complete Database Schema v4.0
-- Unified organizations model: carriers + customers share one table
-- profiles is the single user table for ALL users in the system
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- SECTION 1: ORGANIZATIONS
-- ────────────────────────────────────────────────────────────

-- All companies in the system: carriers (SaaS tenants) and customers (shippers/brokers)
CREATE TABLE organizations (
  id         BIGSERIAL PRIMARY KEY,
  -- 'platform' (added 2026-07-22) is ShipmentX's own tenant row -- the
  -- platform-operator org, not a carrier or customer. See SECTION 3c and
  -- the sx_* profiles.role values below.
  type       TEXT NOT NULL CHECK (type IN ('carrier','customer','platform')),
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  city       TEXT,
  state      TEXT,
  zip        TEXT,
  country    TEXT DEFAULT 'US' CHECK (country IN ('US','CA','MX')),
  currency   TEXT DEFAULT 'USD' CHECK (currency IN ('USD','CAD','MXN')),
  -- Carrier or customer branding logo (added 2026-07-21) -- same `documents`
  -- bucket/path convention as everything else, path {org_id}/logo/{filename}.
  logo_path  TEXT,
  -- Employer Identification Number (added 2026-07-24, onboarding-gap audit) --
  -- carrier-only in practice (customer orgs never collect this) but lives on
  -- `organizations` alongside the rest of the legal/mailing identity fields
  -- (name/address) rather than carrier_details, which is SaaS-tenant config,
  -- not legal-entity identity. Free text, not validated against the
  -- US EIN/CA BN/MX RFC format -- this product operates in three countries
  -- and each has a different tax-ID shape.
  ein        TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Carrier-only fields (SaaS tenant config)
CREATE TABLE carrier_details (
  org_id     BIGINT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  mc_number  TEXT,
  dot_number TEXT,
  load_email TEXT UNIQUE,
  tier       TEXT DEFAULT 'starter' CHECK (tier IN ('starter','growth','pro','enterprise')),
  timezone   TEXT DEFAULT 'America/Los_Angeles',
  uom_system TEXT DEFAULT 'imperial' CHECK (uom_system IN ('imperial','metric')),
  -- Carrier-level default language (added 2026-07-21, decisions.md L4) -- new
  -- team members with a NULL profiles.preferred_language inherit this, same
  -- inheritance shape as uom_system above. Unrelated to roles.
  -- Widened from 4 to 24 codes by migration 0054 (US trucking workforce
  -- language expansion) -- keep in sync with profiles.preferred_language
  -- below and the `languages` reference table.
  default_language TEXT NOT NULL DEFAULT 'en' CHECK (default_language IN (
    'en','es','pa','ur','ru','uk','mn','ar','so','ht','pt','vi','zh','ko','tl','fr','pl','ro','de','hi','gu','am','fa','ne'
  )),
  -- Default billing rail for new invoices (decision R1). Per-invoice override
  -- lives on invoices.payment_method.
  default_payment_method TEXT NOT NULL DEFAULT 'other'
                         CHECK (default_payment_method IN ('stripe','factoring','other')),
  factoring_company      TEXT,
  -- Default net-terms window offered to customers on new invoices (added
  -- 2026-07-24, onboarding-gap audit) -- a starting point for
  -- invoices.due_date, not itself a due date. No consuming code computes
  -- due_date from this yet (invoice creation still leaves due_date to be
  -- set directly); wiring that up is separate follow-on work, out of scope
  -- for just capturing the carrier's stated default at onboarding.
  default_net_terms_days INT NOT NULL DEFAULT 30
                         CHECK (default_net_terms_days IN (7,15,30,45,60)),
  -- Carrier's own subscription billing (demo-mode seam — see lib/stripe.ts).
  -- stripe_customer_id NULL means no payment method on file yet; a
  -- 'demo_cus_...' placeholder once the demo "Add Payment Method" flow runs.
  -- Swapping in real Stripe replaces only createStripeCustomer()'s body.
  billing_status      TEXT NOT NULL DEFAULT 'trialing'
                      CHECK (billing_status IN ('trialing','active','past_due','canceled')),
  trial_ends_at       TIMESTAMPTZ DEFAULT (now() + interval '90 days'),
  stripe_customer_id  TEXT,
  card_brand          TEXT,
  card_last4          TEXT,
  -- Grace period after a failed payment (added 2026-07-22, Phase 8
  -- foundation) -- NULL means not in a grace period. Set/cleared by
  -- ShipmentX admin action (see SECTION 3c's admin_events) or, once real
  -- Stripe webhooks exist, by billing automation. Scaffolded now even
  -- though billing_events/Stripe webhooks are demo-only today (lib/stripe.ts).
  grace_period_until  TIMESTAMPTZ,
  -- Enterprise branding customization (added 2026-09-21, migration 0026,
  -- decisions.md PR1 amendment) -- overrides --color-brand-orange/
  -- --color-teal for this org's app shell + public tracking page when
  -- has_feature('branding_customization') is true. NULL = default theme.
  -- Logo reuses organizations.logo_path (S10) rather than a second column.
  brand_primary_color TEXT CHECK (brand_primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  brand_accent_color  TEXT CHECK (brand_accent_color  ~ '^#[0-9A-Fa-f]{6}$')
);

-- Customer-only fields (shipper/broker, per carrier)
CREATE TABLE customer_details (
  org_id          BIGINT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  carrier_org_id  BIGINT NOT NULL REFERENCES organizations(id),
  customer_number TEXT,
  contact_name    TEXT,  -- primary contact for non-portal customers
  tags            TEXT[] DEFAULT '{}',
  notes           TEXT
);

-- ────────────────────────────────────────────────────────────
-- SECTION 1b: GLOBAL MASTER DATA (2026-07-21)
-- Developer-owned reference/lookup data, shared by every carrier org — no
-- org scoping, no app-writable policy (all RLS is SELECT-only, in SECTION 8
-- alongside every other table's policies, per this file's actual convention).
-- ────────────────────────────────────────────────────────────

-- Vehicle type definitions (icon, generic photo, typical specs) — selected
-- FROM when adding a vehicle. See decisions.md S8.
CREATE TABLE vehicle_types (
  id                            BIGSERIAL PRIMARY KEY,
  code                          TEXT NOT NULL UNIQUE,
  label                         TEXT NOT NULL,
  icon                          TEXT NOT NULL,   -- custom illustrated SVG icon key (NOT Material
                                                  -- Symbols), resolved against carrieros-web/
                                                  -- components/icons/vehicle-types/{code}.tsx
  generic_photo_path            TEXT,            -- stock photo fallback wherever a vehicle has no
                                                  -- per-vehicle photo yet
  typical_length_ft             NUMERIC,         -- reference figures only, not a real per-vehicle spec
  typical_payload_capacity_lbs  NUMERIC,
  typical_cargo_volume_cuft     NUMERIC,
  specialized_capacity_note     TEXT,
  display_order                 INT NOT NULL
);
INSERT INTO vehicle_types
  (code, label, icon, typical_length_ft, typical_payload_capacity_lbs, typical_cargo_volume_cuft, specialized_capacity_note, display_order)
VALUES
  ('semi','Semi (Tractor-Trailer)','local_shipping',53,45000,3489,NULL,1),
  ('box_truck','Box Truck','airport_shuttle',24,10000,1200,NULL,2),
  ('flatbed','Flatbed','view_agenda',48,48000,NULL,'Open deck -- no enclosed cargo volume.',3),
  ('reefer','Reefer','ac_unit',53,44000,3000,'Temperature range approx. -20 deg F to 80 deg F.',4),
  ('step_deck','Step Deck','stairs',48,48000,NULL,'Open deck, two-level (upper ~11 ft / lower ~37 ft) -- no enclosed cargo volume.',5),
  ('tanker','Tanker','propane_tank',43,NULL,NULL,'Liquid capacity typically 5,500-11,600 gal depending on compartment config -- payload varies with liquid density, not a fixed lbs figure.',6),
  ('dump','Dump','delete_sweep',23,25000,NULL,'Volume typically measured in cubic yards (10-16 cu yd), not cubic feet.',7);

-- Multi-region vehicle weight/license classification schemes — many-to-many
-- against vehicle_types via vehicle_type_classifications below, since one
-- type is e.g. simultaneously "US Class 8 AND EU N3 AND China Heavy Truck".
-- 24 rows across 11 regions; deliberately not exhaustive per-region coverage
-- (a representative seed, not a legal reference — see decisions.md S8).
CREATE TABLE vehicle_classifications (
  id                        BIGSERIAL PRIMARY KEY,
  region                    TEXT NOT NULL,   -- plain TEXT, not a CHECK enum -- new regions are added
                                              -- as master-data rows, not a schema change
  scheme_name               TEXT NOT NULL,
  code                      TEXT NOT NULL,
  label                     TEXT NOT NULL,
  min_weight_kg             NUMERIC,
  max_weight_kg             NUMERIC,         -- NULL = open-ended top class
  requires_special_license  BOOLEAN NOT NULL DEFAULT true,
  license_category_note     TEXT,
  display_order             INT NOT NULL,
  UNIQUE (region, code)
);
INSERT INTO vehicle_classifications
  (region, scheme_name, code, label, min_weight_kg, max_weight_kg, requires_special_license, license_category_note, display_order)
VALUES
  ('US','FHWA GVWR','class_4_6','Class 4-6',6350,11793,false,NULL,1),
  ('US','FHWA GVWR','class_8','Class 8',14969,NULL,true,'CDL Class A',2),
  ('EU','EU Vehicle Category (2007/46/EC)','n1','N1',NULL,3500,false,NULL,3),
  ('EU','EU Vehicle Category (2007/46/EC)','n3','N3',12000,NULL,true,'Category C+E',4),
  ('GB','UK Retained EU Vehicle Category (DVSA)','n1','N1',NULL,3500,false,'Category B',5),
  ('GB','UK Retained EU Vehicle Category (DVSA)','n3','N3',12000,NULL,true,'Category C+E',6),
  ('CA','Transport Canada / CCMTA Weight Classification','class_4_6','Class 4-6',6350,11793,false,NULL,7),
  ('CA','Transport Canada / CCMTA Weight Classification','class_8','Class 8',14969,NULL,true,'Class 1 (AZ in Ontario)',8),
  ('MX','NOM-012-SCT-2-2017 Vehicle Configuration','c2','C2 (Rigid, 2-axle)',NULL,17500,false,NULL,9),
  ('MX','NOM-012-SCT-2-2017 Vehicle Configuration','t3_s2','T3-S2 (5-axle tractor-trailer, up to 48t GCW)',17500,48000,true,'Federal Type A/E License',10),
  ('MX','NOM-012-SCT-2-2017 Vehicle Configuration','t3_s3','T3-S3 (6-axle tractor-trailer, 48t+ GCW, special permit)',48000,NULL,true,'Federal Type A/E License + route permit',11),
  ('CN','China GVW Classification (GB/T 15089)','medium_truck','Medium Truck',6000,14000,false,NULL,12),
  ('CN','China GVW Classification (GB/T 15089)','heavy_truck','Heavy Truck',14000,NULL,true,NULL,13),
  ('IN','India GVW Classification (Motor Vehicles Act)','lcv','LCV',3500,7500,false,NULL,14),
  ('IN','India GVW Classification (Motor Vehicles Act)','hcv','HCV',16000,NULL,true,NULL,15),
  ('JP','Japan Vehicle Size/Weight Classification','kei_truck','Kei Truck (Light Vehicle)',NULL,2000,false,'Ordinary License',16),
  ('JP','Japan Vehicle Size/Weight Classification','large_size','Large-Size Truck',11000,NULL,true,'Class 1 Large License',17),
  ('KR','South Korea Truck Weight Classification','small_size','Small-Size Truck',NULL,3000,false,NULL,18),
  ('KR','South Korea Truck Weight Classification','large_size','Large-Size Truck',10000,NULL,true,'Class 1 Large License',19),
  ('AU','Australian Heavy Vehicle Licence Category (NHVR)','light_rigid','Light Rigid (LR)',4500,8000,true,'LR Licence',20),
  ('AU','Australian Heavy Vehicle Licence Category (NHVR)','heavy_combination','Heavy Combination (HC)',9000,NULL,true,'HC Licence',21),
  ('AU','Australian Heavy Vehicle Licence Category (NHVR)','multi_combination','Multi Combination (MC -- B-doubles, road trains)',NULL,NULL,true,'MC Licence',22),
  ('BR','CONTRAN Vehicle Category (Brazilian Traffic Code)','category_c','Category C',3500,6000,true,'CNH Category C',23),
  ('BR','CONTRAN Vehicle Category (Brazilian Traffic Code)','category_e','Category E',6000,NULL,true,'CNH Category E',24);

-- Many-to-many join: 77 rows (7 vehicle_types x 11 regions). MX's t3_s3 and
-- AU's multi_combination stay reachable via vehicle_classifications directly
-- but are not a default join for any type (specialty configurations).
CREATE TABLE vehicle_type_classifications (
  vehicle_type_id    BIGINT NOT NULL REFERENCES vehicle_types(id),
  classification_id  BIGINT NOT NULL REFERENCES vehicle_classifications(id),
  PRIMARY KEY (vehicle_type_id, classification_id)
);
INSERT INTO vehicle_type_classifications (vehicle_type_id, classification_id)
SELECT vt.id, vc.id FROM vehicle_types vt, vehicle_classifications vc
WHERE (vt.code, vc.region, vc.code) IN (
  ('box_truck','US','class_4_6'), ('box_truck','EU','n1'), ('box_truck','GB','n1'),
  ('box_truck','CA','class_4_6'), ('box_truck','MX','c2'), ('box_truck','CN','medium_truck'),
  ('box_truck','IN','lcv'), ('box_truck','JP','kei_truck'), ('box_truck','KR','small_size'),
  ('box_truck','AU','light_rigid'), ('box_truck','BR','category_c'),
  ('semi','US','class_8'), ('semi','EU','n3'), ('semi','GB','n3'), ('semi','CA','class_8'),
  ('semi','MX','t3_s2'), ('semi','CN','heavy_truck'), ('semi','IN','hcv'), ('semi','JP','large_size'),
  ('semi','KR','large_size'), ('semi','AU','heavy_combination'), ('semi','BR','category_e'),
  ('flatbed','US','class_8'), ('flatbed','EU','n3'), ('flatbed','GB','n3'), ('flatbed','CA','class_8'),
  ('flatbed','MX','t3_s2'), ('flatbed','CN','heavy_truck'), ('flatbed','IN','hcv'), ('flatbed','JP','large_size'),
  ('flatbed','KR','large_size'), ('flatbed','AU','heavy_combination'), ('flatbed','BR','category_e'),
  ('reefer','US','class_8'), ('reefer','EU','n3'), ('reefer','GB','n3'), ('reefer','CA','class_8'),
  ('reefer','MX','t3_s2'), ('reefer','CN','heavy_truck'), ('reefer','IN','hcv'), ('reefer','JP','large_size'),
  ('reefer','KR','large_size'), ('reefer','AU','heavy_combination'), ('reefer','BR','category_e'),
  ('step_deck','US','class_8'), ('step_deck','EU','n3'), ('step_deck','GB','n3'), ('step_deck','CA','class_8'),
  ('step_deck','MX','t3_s2'), ('step_deck','CN','heavy_truck'), ('step_deck','IN','hcv'), ('step_deck','JP','large_size'),
  ('step_deck','KR','large_size'), ('step_deck','AU','heavy_combination'), ('step_deck','BR','category_e'),
  ('tanker','US','class_8'), ('tanker','EU','n3'), ('tanker','GB','n3'), ('tanker','CA','class_8'),
  ('tanker','MX','t3_s2'), ('tanker','CN','heavy_truck'), ('tanker','IN','hcv'), ('tanker','JP','large_size'),
  ('tanker','KR','large_size'), ('tanker','AU','heavy_combination'), ('tanker','BR','category_e'),
  ('dump','US','class_8'), ('dump','EU','n3'), ('dump','GB','n3'), ('dump','CA','class_8'),
  ('dump','MX','t3_s2'), ('dump','CN','heavy_truck'), ('dump','IN','hcv'), ('dump','JP','large_size'),
  ('dump','KR','large_size'), ('dump','AU','heavy_combination'), ('dump','BR','category_e')
);

-- Role reference/display data (label/abbreviation/color) — NOT a foreign key,
-- profiles.role keeps its own CHECK as the enforced value. See decisions.md S9.
CREATE TABLE roles (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,   -- must exactly match profiles.role's CHECK list
  label         TEXT NOT NULL,          -- English fallback/dev-reference only -- UI renders via
                                        -- t('roles.' + code), not this column, in end-user surfaces
  abbreviation  TEXT NOT NULL,
  color_token   TEXT NOT NULL,          -- an existing Phase-0A color token name, not a new hex value
  -- Which kind of org this role belongs to (added 2026-07-22, Phase 8 foundation) --
  -- lets the UI/audits tell platform-staff roles apart from tenant roles at a glance.
  -- Adding a role means updating profiles.role's CHECK list AND this table's scope
  -- together, same drift risk already flagged for code/label above.
  scope         TEXT NOT NULL CHECK (scope IN ('carrier','customer','platform')),
  display_order INT NOT NULL
);
INSERT INTO roles (code, label, abbreviation, color_token, scope, display_order) VALUES
  ('owner','Owner','OW','brand-orange','carrier',1),
  ('solo','Solo','SO','brand-orange','carrier',2),
  ('driver','Driver','DR','success','carrier',3),
  ('dispatcher','Dispatcher','DI','info','carrier',4),
  ('finance','Finance','FI','purple','carrier',5),
  ('customer_admin','Customer Admin','CA','navy-muted','customer',6),
  ('customer_viewer','Customer Viewer','CV','navy-muted','customer',7),
  -- ShipmentX platform-staff roles (2026-07-22, Phase 8 foundation). These
  -- profiles live in the ShipmentX 'platform'-type org (see SECTION 3c) --
  -- ordinary auth/profiles rows, no separate auth system. sx_owner: full
  -- access; sx_finance: billing/pipeline scope; sx_support: triage/health/
  -- org-detail/notes scope, no billing or feature-flag writes. Enforced in
  -- app code via lib/admin-auth.ts's requireAdminRole(), not RLS bolted onto
  -- tenant tables -- see the note on SECTION 3c below for why.
  ('sx_owner','SX Owner','SX','brand-orange','platform',8),
  ('sx_finance','SX Finance','SF','purple','platform',9),
  ('sx_support','SX Support','SS','info','platform',10);

-- Single source of truth for role -> capability gating (migration 0009),
-- consumed identically by carrieros-web and carrieros-mobile via
-- scripts/gen-role-capabilities.mjs, instead of hand-duplicated TS arrays
-- (BILLING_ROLES already drifted once between web files, and mobile had no
-- shared source at all). NOT a security boundary -- RLS on the data tables
-- is what enforces access; this only drives navigation/UI gating. Presence
-- of a row = allowed, absence = denied.
CREATE TABLE role_capabilities (
  role       TEXT NOT NULL REFERENCES roles(code),
  capability TEXT NOT NULL,
  PRIMARY KEY (role, capability)
);

COMMENT ON TABLE role_capabilities IS
  'Role -> capability, the single source of truth for role gating in both apps, generated into each by scripts/gen-role-capabilities.mjs. Since 0023 this is an authorization input at the API layer (services and routes), not only navigation gating; RLS on the data tables remains the enforcement backstop beneath it. Presence of a row = allowed, absence = denied.';

INSERT INTO role_capabilities (role, capability) VALUES
  ('owner',      'dashboard'),
  ('owner',      'dispatch'),
  ('owner',      'finance'),
  ('owner',      'my_loads'),
  ('owner',      'drivers'),
  ('owner',      'team'),
  ('owner',      'invoice_actions'),
  ('owner',      'subscription_management'),
  ('owner',      'loads_manage'),
  ('owner',      'loads_advance_status'),
  ('owner',      'load_intake_extract'),
  ('owner',      'documents_upload'),
  ('owner',      'documents_read'),
  ('owner',      'documents_send'),
  ('owner',      'customers_manage'),
  ('owner',      'fuel_log'),
  ('owner',      'problem_report'),
  ('owner',      'chat_participate'),
  ('owner',      'location_share'),
  ('owner',      'ifta_record'),
  ('owner',      'dvir_file'),
  ('owner',      'dvir_attach_any'),
  ('owner',      'service_log'),
  ('owner',      'settlements_manage'),
  ('owner',      'team_manage'),
  ('owner',      'drivers_manage'),
  ('owner',      'vehicles_manage'),
  ('owner',      'loads_view'),
  ('owner',      'customers_view'),
  ('owner',      'exceptions_view'),
  ('owner',      'maintenance_view'),
  ('owner',      'settlements_view'),
  ('owner',      'settings_view'),
  ('owner',      'org_documents_view'),
  ('owner',      'org_documents_manage'),
  ('owner',      'documents_delete'),
  ('owner',      'rate_visibility'),
  -- Migration 0026: Enterprise branding customization (decisions.md PR1 amendment) -- owner/solo only.
  ('owner',      'org_branding_manage'),
  -- Migration 0027: Enterprise org_support ticket queue (decisions.md T16) -- owner/solo only, same
  -- default-grant shape as org_branding_manage above.
  ('owner',      'org_support_manage'),

  ('solo',       'dashboard'),
  ('solo',       'dispatch'),
  ('solo',       'finance'),
  ('solo',       'my_loads'),
  ('solo',       'drivers'),
  ('solo',       'team'),
  ('solo',       'invoice_actions'),
  ('solo',       'subscription_management'),
  ('solo',       'loads_manage'),
  ('solo',       'loads_advance_status'),
  ('solo',       'load_intake_extract'),
  ('solo',       'documents_upload'),
  ('solo',       'documents_read'),
  ('solo',       'documents_send'),
  ('solo',       'customers_manage'),
  ('solo',       'fuel_log'),
  ('solo',       'problem_report'),
  ('solo',       'chat_participate'),
  ('solo',       'location_share'),
  ('solo',       'ifta_record'),
  ('solo',       'dvir_file'),
  ('solo',       'dvir_attach_any'),
  ('solo',       'driver_profile_edit_own'),
  ('solo',       'service_log'),
  ('solo',       'settlements_manage'),
  ('solo',       'team_manage'),
  ('solo',       'drivers_manage'),
  ('solo',       'vehicles_manage'),
  ('solo',       'loads_view'),
  ('solo',       'customers_view'),
  ('solo',       'exceptions_view'),
  ('solo',       'maintenance_view'),
  ('solo',       'settlements_view'),
  ('solo',       'settings_view'),
  ('solo',       'org_documents_view'),
  ('solo',       'org_documents_manage'),
  ('solo',       'documents_delete'),
  ('solo',       'rate_visibility'),
  ('solo',       'org_branding_manage'),
  ('solo',       'org_support_manage'),

  ('dispatcher', 'dashboard'),
  ('dispatcher', 'dispatch'),
  ('dispatcher', 'drivers'),
  ('dispatcher', 'loads_manage'),
  ('dispatcher', 'loads_advance_status'),
  ('dispatcher', 'load_intake_extract'),
  ('dispatcher', 'documents_upload'),
  ('dispatcher', 'documents_read'),
  ('dispatcher', 'documents_send'),
  ('dispatcher', 'customers_manage'),
  ('dispatcher', 'fuel_log'),
  ('dispatcher', 'chat_participate'),
  ('dispatcher', 'ifta_record'),
  ('dispatcher', 'loads_view'),
  ('dispatcher', 'customers_view'),
  ('dispatcher', 'exceptions_view'),
  ('dispatcher', 'maintenance_view'),
  ('dispatcher', 'settings_view'),

  ('finance',    'dashboard'),
  ('finance',    'finance'),
  ('finance',    'invoice_actions'),
  ('finance',    'documents_read'),
  ('finance',    'settlements_manage'),
  ('finance',    'loads_view'),
  ('finance',    'customers_view'),
  ('finance',    'settlements_view'),
  ('finance',    'settings_view'),
  ('finance',    'org_documents_view'),
  ('finance',    'rate_visibility'),

  ('driver',     'dashboard'),
  ('driver',     'my_loads'),
  ('driver',     'loads_advance_status'),
  ('driver',     'documents_upload'),
  ('driver',     'documents_read'),
  ('driver',     'fuel_log'),
  ('driver',     'problem_report'),
  ('driver',     'chat_participate'),
  ('driver',     'location_share'),
  ('driver',     'ifta_record'),
  ('driver',     'dvir_file'),
  ('driver',     'driver_profile_edit_own'),
  ('driver',     'settlements_view'),
  ('driver',     'settings_view'),

  ('sx_owner',   'admin'),
  ('sx_owner',   'admin_billing'),
  ('sx_owner',   'admin_flags'),
  ('sx_owner',   'admin_impersonate'),
  -- Migration 0028: fix-forward capability for staffing ShipmentX's own carrieros_support queue
  -- (decisions.md T16) -- sx_owner/sx_support only, matching 0027's RLS policies; NOT sx_finance.
  ('sx_owner',   'admin_support'),
  -- Migration 0031: LLM provider abstraction (decisions.md T17) -- sx_owner only, NOT sx_finance/
  -- sx_support despite being cost-adjacent, since it also decides which outside vendor sees
  -- ticket/load content.
  ('sx_owner',   'admin_ai_config'),
  ('sx_finance', 'admin'),
  ('sx_finance', 'admin_billing'),
  ('sx_support', 'admin'),
  ('sx_support', 'admin_impersonate'),
  -- Migration 0028: fix-forward capability for staffing ShipmentX's own carrieros_support queue
  -- (decisions.md T16) -- sx_owner/sx_support only, matching 0027's RLS policies; NOT sx_finance.
  ('sx_support', 'admin_support'),
  -- Migration 0048: these two intentionally got zero rows at 0009 ("today's code has no defined
  -- behavior for them either... denied by default is the honest current state") -- but proxy.ts's
  -- redirect logic assumes every authenticated role reaches SOME capability-gated page, so zero
  -- capabilities meant an infinite redirect loop (ROLE_HOME default '/dashboard' -> denied, no
  -- ROLE_HOME entry -> '/dashboard' again), not just "no view", confirmed live 2026-09-27. `dashboard`
  -- only, so they land on the already-built noViewForRole fallback message
  -- (app/(app)/dashboard/page.tsx) instead -- not a real customer-portal experience, which is
  -- separate, larger feature work.
  ('customer_admin',  'dashboard'),
  ('customer_viewer', 'dashboard');

-- Migration 0052: DAT load-board integration (Phase 1, posting only) -- gates BOTH managing the org's
-- DAT credential (Settings > Integrations > Load Board) and posting a load, owner/solo/dispatcher
-- only (the same three roles that hold dispatch/loads_manage above), NOT finance or driver. See
-- Migration 0052's header comment for why this differs from telematics_integrations'
-- subscription_management (owner/solo-only) gate.
INSERT INTO role_capabilities (role, capability) VALUES
  ('owner',      'loadboard_posting'),
  ('solo',       'loadboard_posting'),
  ('dispatcher', 'loadboard_posting');

-- Language reference/display data — NOT a foreign key, profiles.preferred_language
-- and carrier_details.default_language keep their own CHECKs. native_name IS the
-- correct display value regardless of UI locale (a language's own name in its own
-- script). See decisions.md S9/L4.
CREATE TABLE languages (
  code          TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  native_name   TEXT NOT NULL,
  flag_emoji    TEXT NOT NULL,
  display_order INT NOT NULL
);
-- Rows 5-24 added by migration 0054 (US trucking workforce language expansion).
INSERT INTO languages (code, label, native_name, flag_emoji, display_order) VALUES
  ('en','English','English','🇺🇸',1),
  ('es','Spanish','Español','🇲🇽',2),
  ('pa','Punjabi','ਪੰਜਾਬੀ','🇮🇳',3),
  ('ur','Urdu','اردو','🇵🇰',4),
  ('ru','Russian','Русский','🇷🇺',5),
  ('uk','Ukrainian','Українська','🇺🇦',6),
  ('mn','Mongolian','Монгол','🇲🇳',7),
  ('ar','Arabic','العربية','🇸🇦',8),
  ('so','Somali','Soomaali','🇸🇴',9),
  ('ht','Haitian Creole','Kreyòl Ayisyen','🇭🇹',10),
  ('pt','Portuguese','Português','🇧🇷',11),
  ('vi','Vietnamese','Tiếng Việt','🇻🇳',12),
  ('zh','Chinese (Simplified)','简体中文','🇨🇳',13),
  ('ko','Korean','한국어','🇰🇷',14),
  ('tl','Tagalog','Tagalog','🇵🇭',15),
  ('fr','French','Français','🇫🇷',16),
  ('pl','Polish','Polski','🇵🇱',17),
  ('ro','Romanian','Română','🇷🇴',18),
  ('de','German','Deutsch','🇩🇪',19),
  ('hi','Hindi','हिन्दी','🇮🇳',20),
  ('gu','Gujarati','ગુજરાતી','🇮🇳',21),
  ('am','Amharic','አማርኛ','🇪🇹',22),
  ('fa','Persian/Farsi','فارسی','🇮🇷',23),
  ('ne','Nepali','नेपाली','🇳🇵',24);

-- Tier entitlements master data (2026-07-21, decisions.md S11). Cumulative/
-- ordered by `rank`, not a many-to-many join -- Growth includes everything
-- Starter has, per BRD's own "Growth+" notation. Real pricing per BR-24.
CREATE TABLE tiers (
  code                        TEXT PRIMARY KEY CHECK (code IN ('starter','growth','pro','enterprise')),
  label                       TEXT NOT NULL,
  rank                        INT NOT NULL UNIQUE,
  monthly_price               NUMERIC(10,2) NOT NULL,
  included_trucks             INT NOT NULL,
  price_per_additional_truck  NUMERIC(10,2) NOT NULL
);
INSERT INTO tiers (code, label, rank, monthly_price, included_trucks, price_per_additional_truck) VALUES
  ('starter','Starter',1,49,1,15),
  ('growth','Growth',2,99,3,20),
  ('pro','Pro',3,199,6,25),
  ('enterprise','Enterprise',4,349,12,30);

-- One row per gated feature, checked via has_feature() (SECTION 8, defined
-- after my_org_id()). Seeded incrementally as each gated feature is actually
-- built -- these 3 back Phase 6's exceptions-system gating (decisions.md P2
-- amendment); mockups 17-21's not-yet-built Growth/Pro items are NOT
-- speculatively seeded here.
CREATE TABLE features (
  key           TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  min_tier      TEXT NOT NULL REFERENCES tiers(code),
  display_order INT NOT NULL,
  -- Survives trial expiry / cancellation / past_due (0021): what a customer needs in order to pay or export.
  retained_when_delinquent BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO features (key, label, min_tier, display_order) VALUES
  ('full_exceptions_inbox','Full Exceptions Inbox','growth',1),
  ('exception_history','Exception History Timelines','growth',2),
  ('customer_health_score','Customer Health Score','growth',3),
  -- Added 2026-07-21: BRD §9's role table puts Dispatcher/Finance at Growth+,
  -- but nothing enforced it until this pass -- app/api/team/invite/route.ts
  -- now checks this before allowing either role to be invited.
  ('dispatcher_finance_roles','Dispatcher & Finance Roles','growth',4);

-- Phase 7F (2026-07-21): Growth/Pro backend scaffold's feature gates. Seeded
-- now (unlike mockups 17-21's originally-deferred rows) since these features
-- are being scaffolded in this same phase -- fuel_stops logging itself,
-- load creation/dispatch, and DVIR/compliance stay ungated (all-tier,
-- safety/operational per the BRD's own stated principle); only the
-- analytics/reporting LAYER on top is gated.
INSERT INTO features (key, label, min_tier, display_order) VALUES
  ('driver_chat','Driver In-App Chat','growth',5),
  ('ifta_mileage_log','IFTA Mileage Log','growth',6),
  ('driver_settlements','Driver Settlements','growth',7),
  ('desktop_command_center','Desktop Command Center','growth',8),
  ('load_expenses','Load Expense Tracking','growth',9),
  ('quickbooks_export','QuickBooks Export','growth',10),
  ('ifta_tax_hub','Full IFTA Tax Reporting','pro',11),
  ('fuel_analytics','Fuel Card Integration & Analytics','pro',12),
  ('settlement_ach','ACH Settlement Payments','pro',13),
  ('driver_performance_analytics','Driver Performance & Lane Analytics','pro',14);

-- Phase 9 (migration 0025): the public developer API's own tier gate, same features/has_feature() model as
-- every other gated capability. Starter-tier orgs cannot use the public API at all.
INSERT INTO features (key, label, min_tier, display_order) VALUES
  ('public_api', 'Public Developer API', 'growth', 15);

-- Migration 0026 (2026-09-21): the first feature to actually use min_tier = 'enterprise' --
-- decisions.md PR1's amended, scoped-down "branding customization" (logo + brand colors), not the
-- originally-undefined "white-label".
INSERT INTO features (key, label, min_tier, display_order) VALUES
  ('branding_customization', 'Branding Customization', 'enterprise', 16);

-- Migration 0027 (2026-09-21): decisions.md T16 -- in-app support ticketing's org_support queue is
-- the second feature to use min_tier = 'enterprise'. carrieros_support (the AI-triage + platform-staff
-- queue) is available on every tier and is NOT gated by this row -- see SECTION 24 below.
INSERT INTO features (key, label, min_tier, display_order) VALUES
  ('support_desk', 'Dedicated Support Desk', 'enterprise', 17);

-- Migration 0052 (2026-09-27): DAT load-board integration, Phase 1 (posting only, mocked client) --
-- Growth+, same features/has_feature() model as everything above.
INSERT INTO features (key, label, min_tier, display_order) VALUES
  ('loadboard_posting', 'DAT Load Board Posting', 'growth', 18);

-- ────────────────────────────────────────────────────────────
-- SECTION 2: PROFILES — ALL users in the system
-- Carrier users:          org_id → carrier organization, role ∈ {owner,solo,driver,dispatcher,finance}
-- Customer portal users:  org_id → customer organization, role ∈ {customer_admin,customer_viewer}
-- ────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id             BIGINT NOT NULL REFERENCES organizations(id),
  -- sx_owner/sx_finance/sx_support (added 2026-07-22, Phase 8 foundation) are
  -- ShipmentX platform-staff roles -- these profiles live in the ShipmentX
  -- 'platform'-type org (SECTION 3c), not any carrier/customer tenant.
  -- Adding a role here means updating the roles table's scope column too
  -- (see its comment) or the new role silently has no display data.
  role               TEXT NOT NULL CHECK (role IN (
    'owner','solo','driver','dispatcher','finance',
    'customer_admin','customer_viewer',
    'sx_owner','sx_finance','sx_support'
  )),
  first_name         TEXT,
  last_name          TEXT,
  phone              TEXT,
  -- Nullable as of 2026-07-21 (decisions.md L4) -- NULL means "inherit
  -- carrier_details.default_language", same shape as uom_system below.
  -- Widened from 4 to 24 codes by migration 0054 -- keep in sync with
  -- carrier_details.default_language above and the `languages` table.
  preferred_language TEXT CHECK (preferred_language IN (
    'en','es','pa','ur','ru','uk','mn','ar','so','ht','pt','vi','zh','ko','tl','fr','pl','ro','de','hi','gu','am','fa','ne'
  )),
  timezone           TEXT,
  -- Per-user overrides of carrier_details defaults (decisions.md L2 — personal
  -- prefs follow the user). NULL uom_system means "inherit from carrier_details".
  uom_system         TEXT CHECK (uom_system IN ('imperial','metric')),
  date_format        TEXT DEFAULT 'MM/DD/YYYY' CHECK (date_format IN ('MM/DD/YYYY','DD/MM/YYYY','YYYY-MM-DD')),
  time_format        TEXT DEFAULT '12h' CHECK (time_format IN ('12h','24h')),
  -- Light/dark appearance (2026-07-26). NOT NULL rather than nullable-means-
  -- inherit like uom_system above: there is no org-level theme to inherit
  -- from. Default 'dark' (fixed 2026-09-21, migration 0030) per
  -- decisions.md V3's explicit, never-amended requirement -- "no visible
  -- change for any existing/new user until they explicitly opt in"; the
  -- default briefly drifted to 'system' unreviewed against that text
  -- (violates it directly for any new signup on a light-OS device). Mobile
  -- mirrors this into AsyncStorage so the pre-login screens (welcome/login/
  -- signup) and cold start can theme themselves before any profile row is
  -- readable -- that anonymous/pre-auth bootstrap is a separate concern and
  -- deliberately still resolves to 'system', since there is no profile row
  -- to violate "no visible change" for a visitor who has never signed up.
  theme_preference   TEXT NOT NULL DEFAULT 'dark' CHECK (theme_preference IN ('light','dark','system')),
  -- Driver photo (2026-07-21, decisions.md S10) -- mobile-captured only, web
  -- is display-only (signed URL). Same `documents` bucket path convention.
  avatar_path        TEXT,
  -- Deactivate, never delete (2026-07-21 standing directive) -- removing a
  -- team member or revoking a customer portal contact's access sets this
  -- false rather than deleting the row, preserving history on everything
  -- that FKs to profiles. my_org_id()/my_role() below both filter on this,
  -- so a deactivated user transparently loses access through every RLS
  -- policy that calls those helpers -- but NOT through the handful of older
  -- policies that subquery profiles directly instead of via the helpers
  -- (see the comment on customer_loads_select/customer_invoices_select in
  -- SECTION 8 for the two that matter for portal contacts specifically;
  -- owner_solo_loads_all/dispatcher_*/finance_*/driver_own_loads_select/
  -- billing_invoices_all are the same pre-existing pattern and are NOT
  -- covered by this column yet -- flag if "deactivate a team member" is
  -- ever built for those roles, not just portal contacts).
  is_active          BOOLEAN NOT NULL DEFAULT true,
  -- Expo push token (2026-07-23) -- one per user, most-recent-device-wins
  -- (not a multi-device list; a user reinstalling/switching phones just
  -- overwrites it, matching this project's "no history needed" defaults
  -- elsewhere). Set by the mobile app after notification permission is
  -- granted; read by lib/send-push.ts when a load is dispatched to a driver.
  push_token         TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- Customer contacts (Phase 3H, 2026-07-22) -- a customer is one organization
-- with one or more contacts; some contacts may also have portal login (see
-- customer_admin/customer_viewer in profiles.role's CHECK list, which were
-- real values with real RLS policies for a long time before anything ever
-- created a profile with either role -- this table + the invite route close
-- that gap). `customer_details.contact_name` stays as the lightweight "who
-- do we talk to" quick-add field on the customer create/onboarding forms;
-- this table is the real, manageable contact list on the customer detail
-- page. Defined here (after profiles, not up near customer_details in
-- SECTION 1) because portal_profile_id FKs into profiles -- placing it any
-- earlier repeats the exact ordering bug this project has hit before
-- (org_sequences/has_feature() needing my_org_id() defined first).
CREATE TABLE customer_contacts (
  id                 BIGSERIAL PRIMARY KEY,
  org_id             BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  carrier_org_id     BIGINT NOT NULL REFERENCES organizations(id),
  name               TEXT NOT NULL,
  email              TEXT,
  phone              TEXT,
  title              TEXT,  -- free text ("AP", "Dispatch") -- not this app's
                             -- own role enum, same reasoning as vehicles.dimensions
  is_primary         BOOLEAN NOT NULL DEFAULT false,
  -- NULL = contact on file, no portal login. Set = this contact can also log
  -- in, via the profiles row this points to. Revoking access deactivates
  -- that profile (is_active = false) and nulls this column -- never deletes
  -- the contact row or the profile row (2026-07-21 deactivate-not-delete
  -- directive). More than one contact per customer can have portal access.
  portal_profile_id  UUID REFERENCES profiles(id),
  created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_customer_contacts_org ON customer_contacts(org_id);

-- ────────────────────────────────────────────────────────────
-- SECTION 3: CARRIER ENTITIES
-- ────────────────────────────────────────────────────────────

-- Renamed from `trucks` (2026-07-21, decisions.md S8) -- region-neutral name
-- to match the international vehicle_types/vehicle_classifications taxonomy.
CREATE TABLE vehicles (
  id              BIGSERIAL PRIMARY KEY,
  carrier_org_id  BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_number  TEXT,
  nickname        TEXT NOT NULL,
  year            INT,
  make            TEXT,
  model           TEXT,
  vin             TEXT,
  license_plate   TEXT,
  license_state   TEXT,
  is_active       BOOLEAN DEFAULT true,
  -- Added 2026-07-21 (decisions.md S8): required, backfilled to 'semi' for
  -- pre-existing rows before being made NOT NULL.
  vehicle_type_id BIGINT NOT NULL REFERENCES vehicle_types(id),
  -- Cab configuration -- nullable, only meaningful for tractor-style vehicles.
  cab_type        TEXT CHECK (cab_type IN ('sleeper','day_cab','other')),
  color           TEXT,
  dimensions      TEXT,
  -- Manually toggled fleet status (decisions.md, "Vehicle status" decision) --
  -- not derived from maintenance data, which can't represent "in shop right now".
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','idle','in_shop')),
  -- Vehicle photo (2026-07-21, decisions.md S10) -- both mobile (DVIR-flow
  -- capture) and web (simple upload) surfaces write here.
  photo_path      TEXT,
  -- Telematics device registration (migration 0042) -- which vendor (if any) reports this vehicle's
  -- GPS position, and that vendor's own id for it. See migration 0042's header comment.
  telematics_provider  TEXT CHECK (telematics_provider IN ('samsara','motive')),
  telematics_device_id TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE drivers (
  id                         BIGSERIAL PRIMARY KEY,
  carrier_org_id             BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id                 UUID NOT NULL REFERENCES profiles(id),
  driver_number              TEXT,
  invite_status              TEXT DEFAULT 'pending' CHECK (invite_status IN ('pending','accepted','revoked')),
  default_vehicle_id         BIGINT REFERENCES vehicles(id),
  is_active                  BOOLEAN DEFAULT true,
  cdl_number                 TEXT,
  cdl_class                  TEXT CHECK (cdl_class IN ('A','B','C')),
  cdl_state                  TEXT,
  cdl_expiry                 DATE,
  med_cert_expiry            DATE,
  endorsements               TEXT[] DEFAULT '{}',
  emergency_contact_name     TEXT,
  emergency_contact_phone    TEXT,
  emergency_contact_relation TEXT,
  created_at                 TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE loads (
  id                BIGSERIAL PRIMARY KEY,
  carrier_org_id    BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_org_id   BIGINT REFERENCES organizations(id),
  customer_name_raw TEXT,
  load_number       TEXT NOT NULL,
  driver_id         BIGINT REFERENCES drivers(id),
  vehicle_id        BIGINT REFERENCES vehicles(id),
  pickup_address    TEXT,
  pickup_city       TEXT,
  pickup_state      TEXT,
  pickup_zip        TEXT,
  pickup_lat        NUMERIC,
  pickup_lng        NUMERIC,
  delivery_address  TEXT,
  delivery_city     TEXT,
  delivery_state    TEXT,
  delivery_zip      TEXT,
  delivery_lat      NUMERIC,
  delivery_lng      NUMERIC,
  total_miles       NUMERIC(8,1),
  pickup_date       DATE,
  pickup_time       TIME,
  delivery_date     DATE,
  delivery_time     TIME,
  commodity         TEXT,
  weight_lbs        INT,
  rate              NUMERIC(10,2),
  -- 'declined' added 2026-07-22 (docs/feature-completeness-audit.md's #2
  -- gap, PRD story "As Sam, I want to accept or decline a load"): distinct
  -- from 'cancelled' on purpose — PRD edge case #8 explicitly separates
  -- "cancel an ACCEPTED load" from decline, which only ever applies to a
  -- still-'draft' (pre-acceptance) load. See components/DispatchPanel.tsx.
  status            TEXT DEFAULT 'draft' CHECK (status IN (
    'draft','scheduled','dispatched','picked_up','in_transit','delivered','invoiced','paid','cancelled','declined'
  )),
  intake_method     TEXT CHECK (intake_method IN ('email','pdf','paste','manual')),
  raw_intake_text   TEXT,
  extraction_data   JSONB,
  tracking_token    TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,
  last_location_lat NUMERIC,
  last_location_lng NUMERIC,
  last_location_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE load_events (
  id           BIGSERIAL PRIMARY KEY,
  load_id      BIGINT NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  note         TEXT,
  location_lat NUMERIC,
  location_lng NUMERIC,
  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE documents (
  id             BIGSERIAL PRIMARY KEY,
  load_id        BIGINT REFERENCES loads(id) ON DELETE CASCADE,
  carrier_org_id BIGINT REFERENCES organizations(id),
  type           TEXT CHECK (type IN ('pod','rate_con','bol','other')),
  storage_path   TEXT NOT NULL,
  uploaded_by    UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE invoices (
  id              BIGSERIAL PRIMARY KEY,
  carrier_org_id  BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_org_id BIGINT REFERENCES organizations(id),
  load_id         BIGINT REFERENCES loads(id),
  invoice_number  TEXT NOT NULL,
  amount          NUMERIC(10,2) NOT NULL,
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue')),
  sent_at         TIMESTAMPTZ,
  due_date        DATE,
  paid_at         TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  -- Decision R1 (added 2026-07-20): Stripe direct AND factoring both supported.
  -- Per-invoice choice; carrier_details.default_payment_method seeds it.
  -- Factoring is a notify-stub until a partner (TriumphPay) is signed — these
  -- columns are shaped so a real integration fills them rather than replacing.
  payment_method      TEXT NOT NULL DEFAULT 'other'
                      CHECK (payment_method IN ('stripe','factoring','other')),
  factoring_company   TEXT,
  factoring_reference TEXT,
  factored_at         TIMESTAMPTZ,
  -- Email-open tracking (added 2026-07-24, invoicing-gap audit) -- set once,
  -- the first time the tracking pixel embedded in the invoice email
  -- (app/api/invoices/[id]/track/route.ts) is fetched. NULL means "not
  -- opened yet or opened via a client that blocks remote images" -- this is
  -- a best-effort signal, not proof the recipient never saw it.
  opened_at           TIMESTAMPTZ
);
-- One invoice per load — a double-billed load is the kind of error a carrier
-- only finds out about when the customer complains.
CREATE UNIQUE INDEX invoices_load_unique ON invoices(load_id) WHERE load_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- SECTION 3b: GROWTH/PRO BACKEND SCAFFOLD (2026-07-21, Phase 7)
-- Data model + RLS only, per the user's "data model first, then API
-- contracts, business logic later" directive. Business-logic bodies (fuel
-- cost validation, IFTA tax filing, settlement PDF/ACH) are deferred —
-- see Phase 7's plan notes. Nothing here may hardcode a non-localizable
-- string; DB `label`/enum columns are English dev-fallback only, same rule
-- as roles/vehicle_types (S9/S8) — real UI renders via message-catalog keys.
-- ────────────────────────────────────────────────────────────

-- 7B: fuel logging (all-tier) + load expenses (Growth+, gated at the app/UI
-- layer via has_feature('load_expenses') — RLS itself doesn't need to know
-- about tiers, same reasoning as every other has_feature() consumer).
CREATE TABLE fuel_stops (
  id                BIGSERIAL PRIMARY KEY,
  carrier_org_id    BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id        BIGINT REFERENCES vehicles(id),
  driver_id         BIGINT REFERENCES drivers(id),
  load_id           BIGINT REFERENCES loads(id),   -- nullable: a fuel stop can be standalone
  state             TEXT NOT NULL,
  station           TEXT,
  stop_date         DATE NOT NULL,
  gallons           NUMERIC NOT NULL,
  price_per_gallon  NUMERIC,
  total_cost        NUMERIC NOT NULL,   -- validated server-side, never trust the client's math
  odometer          INT,
  receipt_path      TEXT,               -- same documents-bucket convention as T11
  logged_by         UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE load_expenses (
  id             BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  load_id        BIGINT NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  expense_type   TEXT NOT NULL,   -- 'toll'|'lumper'|'scale'|'other' -- exact set TBD at UI time
  amount         NUMERIC NOT NULL,
  note           TEXT,
  logged_by      UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- 7C: IFTA (BR-22/BR-23) -- Growth+ for the mileage log, Pro+ for tax
-- computation/filing export.
CREATE TABLE ifta_state_crossings (
  id             BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id     BIGINT REFERENCES vehicles(id),
  driver_id      BIGINT REFERENCES drivers(id),
  load_id        BIGINT REFERENCES loads(id),
  state          TEXT NOT NULL,
  crossed_at     TIMESTAMPTZ NOT NULL,
  lat            NUMERIC,   -- nullable when source = 'manual'
  lng            NUMERIC,
  odometer_est   INT,
  -- Manual-entry override rule (BR-22): saving manual rows for a load DELETEs
  -- all source='gps' rows for that load first -- never mixed. Business logic
  -- (deferred, see replace_ifta_crossings() in Phase 7G's contract table),
  -- but this single discriminator column is what makes that swap a plain
  -- DELETE+INSERT rather than a merge.
  source         TEXT NOT NULL CHECK (source IN ('gps','manual')),
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Global reference data (like tiers/vehicle_classifications) -- NOT
-- org-scoped, no app-write policy. Deliberately unseeded: real IFTA rates
-- need a real quarterly data source (published state tax-authority tables),
-- not researched/approximated -- flag before go-live in any IFTA region.
CREATE TABLE ifta_tax_rates (
  id              BIGSERIAL PRIMARY KEY,
  state           TEXT NOT NULL,
  quarter         TEXT NOT NULL,   -- 'YYYY-Qn'
  rate_per_gallon NUMERIC NOT NULL,
  UNIQUE (state, quarter)
);

-- 7D: driver chat (BRD FR-15.1-15.3, Growth+ only -- mockup-19's "90 days on
-- Starter" copy is stale, confirmed with the user 2026-07-21).
CREATE TABLE driver_messages (
  id                BIGSERIAL PRIMARY KEY,
  carrier_org_id    BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  load_id           BIGINT NOT NULL REFERENCES loads(id) ON DELETE CASCADE,   -- strictly per-load
  sender_id         UUID REFERENCES profiles(id),   -- NULL = system message
  body              TEXT NOT NULL,
  -- Defaults to sender's own profiles.preferred_language at send time (app
  -- layer, not a DB default -- the sender is only known at insert time).
  original_language TEXT,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at           TIMESTAMPTZ   -- NULL = unread
);

CREATE TABLE driver_message_translations (
  id              BIGSERIAL PRIMARY KEY,
  message_id      BIGINT NOT NULL REFERENCES driver_messages(id) ON DELETE CASCADE,
  target_language TEXT NOT NULL,
  translated_body TEXT NOT NULL,
  translated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (message_id, target_language)   -- multiple readers sharing a target
                                          -- language reuse the same cached row
);

-- 7E: driver settlements (BRD FR-116, Growth+ calc/PDF, Pro+ ACH).
-- pay_method/rate_value are SNAPSHOTTED per settlement (confirmed with the
-- user 2026-07-21) -- a later change to a driver's default settlement_type
-- never rewrites past settlement history.
ALTER TABLE drivers ADD COLUMN settlement_type TEXT CHECK (settlement_type IN (
  'percent_of_rate','per_mile','flat_per_load'
));   -- the driver's current DEFAULT method; nullable (not every driver is
      -- settled this way, e.g. W2 employees -- out of scope, don't force a value)

-- The numeric rate paired with settlement_type (the % for percent_of_rate,
-- $/mile for per_mile, $/load for flat_per_load). Added 2026-07-22 — the
-- original settlement_type column shipped with nothing to actually compute
-- pay from, which is why app/api/settlements/run/route.ts's real math was
-- deferred to a placeholder (sum of loads.rate) instead of applying a rate.
ALTER TABLE drivers ADD COLUMN settlement_rate NUMERIC;

CREATE TABLE driver_settlements (
  id                 BIGSERIAL PRIMARY KEY,
  carrier_org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  driver_id          BIGINT REFERENCES drivers(id),
  load_id            BIGINT REFERENCES loads(id),   -- nullable: settlements can
                                                      -- be a period-level aggregate
  pay_method         TEXT NOT NULL CHECK (pay_method IN (
    'percent_of_rate','per_mile','flat_per_load'
  )),
  gross_revenue      NUMERIC NOT NULL,
  net_pay            NUMERIC NOT NULL,
  loads_count        INT,
  rate_value         NUMERIC,   -- the % or $/mile actually applied, snapshotted
  advance_amount     NUMERIC DEFAULT 0,
  payment_status     TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN (
    'pending','sent','cleared'
  )),
  period_start       DATE,
  period_end         DATE,
  pdf_statement_path TEXT,
  created_by         UUID REFERENCES profiles(id),
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- Forward-compatible deductions/garnishments (BRD's own OQ-11c marks this
-- unresolved for MVP) -- a child line-item table so a real garnishment rule
-- added later doesn't force a migration.
CREATE TABLE settlement_deductions (
  id             BIGSERIAL PRIMARY KEY,
  settlement_id  BIGINT NOT NULL REFERENCES driver_settlements(id) ON DELETE CASCADE,
  deduction_type TEXT NOT NULL,   -- 'advance'|'garnishment'|'other' -- exact set TBD
  amount         NUMERIC NOT NULL,
  note           TEXT
);

-- ────────────────────────────────────────────────────────────
-- SECTION 3c: PLATFORM ADMIN (SHIPMENTX) BACKEND (2026-07-22, Phase 8 foundation)
-- ────────────────────────────────────────────────────────────
-- ShipmentX platform staff are ordinary profiles rows in a 'platform'-type
-- organizations row (see SECTION 1's type CHECK), with role IN
-- ('sx_owner','sx_finance','sx_support') -- no separate auth system, reuses
-- the same Supabase Auth/magic-link/session machinery as every other user.
--
-- CRITICAL: a ShipmentX profile's my_org_id() still resolves to ShipmentX's
-- OWN org id. Org membership must NEVER be bolted onto an existing tenant
-- table's RLS policy as an "OR is platform staff" exception -- that risks
-- the recursive-RLS/missing-grant bug classes this project has already hit
-- twice (the org_sequences ordering bug, a table shipped with RLS enabled
-- but no policy). The 5 tables below are ShipmentX's OWN domain data, so
-- ordinary RLS keyed on my_role() is fine here. Cross-org READS of existing
-- tenant tables (loads/invoices/carrier_details/etc, needed for the triage
-- queue and health board) go through app/api/admin/** routes using the
-- service-role client, gated by the same role check in application code
-- (lib/admin-auth.ts's requireAdminRole()) -- never through loosened RLS on
-- the tenant tables themselves. See docs/design/mockups/mockup-23-super-admin.html
-- for the screens this backs.

CREATE TABLE admin_notes (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  admin_id   UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_admin_notes_org ON admin_notes(org_id);

-- Audit trail of ShipmentX admin-initiated actions (impersonate, suspend,
-- extend-trial, change-tier, flag-edit, note-add). Scoped to admin actions
-- only for this pass -- NOT a mirror of all tenant activity across every
-- org (every load/invoice/login event) -- that would require instrumenting
-- many existing routes across the app and is a larger, separate future
-- effort. org_id/admin_id are nullable for system-wide events with no
-- single org or human actor.
CREATE TABLE admin_events (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
  admin_id   UUID REFERENCES profiles(id),
  event_type TEXT NOT NULL,   -- 'admin.impersonate'|'admin.suspend'|'admin.extend_trial'|
                              -- 'admin.change_tier'|'admin.flag_edit'|'admin.note_add'
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_admin_events_org ON admin_events(org_id);
CREATE INDEX idx_admin_events_created ON admin_events(created_at);

-- Scaffolded now per the 2026-07-22 decision even though Stripe is still a
-- demo-only stub (lib/stripe.ts) -- populated once real Stripe webhooks
-- exist; the Billing & Payments admin screen shows empty/demo state until
-- then, same seam-first approach as the rest of this app's Stripe handling.
CREATE TABLE billing_events (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_event_id TEXT UNIQUE,   -- NULL for any demo-seam-inserted row until real Stripe exists
  event_type      TEXT NOT NULL,   -- 'charge.succeeded'|'charge.failed'|'card.expiring'|...
  amount          NUMERIC,
  status          TEXT,
  card_last4      TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_billing_events_org ON billing_events(org_id);

-- Operational kill-switches / staged-rollout flags -- deliberately a
-- SEPARATE system from SECTION 1b's tiers/features/has_feature() (which is
-- commercial tier entitlement gating). platform_flags is about whether a
-- capability is operationally on at all (e.g. "is AI load-extraction
-- enabled right now"), independent of what tier an org is on.
CREATE TABLE platform_flags (
  flag_key        TEXT PRIMARY KEY,
  description     TEXT NOT NULL,
  default_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE org_flag_overrides (
  org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  flag_key   TEXT NOT NULL REFERENCES platform_flags(flag_key) ON DELETE CASCADE,
  enabled    BOOLEAN NOT NULL,
  set_by     UUID REFERENCES profiles(id),
  set_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (org_id, flag_key)
);

-- ────────────────────────────────────────────────────────────
-- SECTION 4: COMPLIANCE & MAINTENANCE
-- ────────────────────────────────────────────────────────────

CREATE TABLE dvir_inspections (
  id             BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT REFERENCES organizations(id),
  vehicle_id     BIGINT REFERENCES vehicles(id),
  load_id        BIGINT REFERENCES loads(id),
  driver_id      BIGINT REFERENCES drivers(id),
  type           TEXT NOT NULL CHECK (type IN ('pre_trip','post_trip')),
  condition      TEXT NOT NULL CHECK (condition IN ('satisfactory','defects_noted')),
  odometer       INT,
  signature_url  TEXT,
  submitted_at   TIMESTAMPTZ DEFAULT now(),
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dvir_defects (
  id            BIGSERIAL PRIMARY KEY,
  inspection_id BIGINT REFERENCES dvir_inspections(id) ON DELETE CASCADE,
  area          TEXT NOT NULL,
  description   TEXT,
  photo_path    TEXT,
  severity      TEXT CHECK (severity IN ('minor','major')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE service_logs (
  id             BIGSERIAL PRIMARY KEY,
  vehicle_id     BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
  carrier_org_id BIGINT REFERENCES organizations(id),
  service_type   TEXT NOT NULL,
  service_date   DATE NOT NULL,
  odometer       INT,
  cost           NUMERIC(10,2),
  shop_name      TEXT,
  notes          TEXT,
  -- Shop receipt/invoice photo (2026-07-21, decisions.md S10) -- one column,
  -- not a separate document table, since a service log entry has exactly one
  -- receipt in the common case.
  receipt_path   TEXT,
  logged_by      UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE maintenance_reminders (
  id                BIGSERIAL PRIMARY KEY,
  vehicle_id        BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
  carrier_org_id    BIGINT REFERENCES organizations(id),
  reminder_type     TEXT NOT NULL,
  trigger_miles     INT,
  trigger_months    INT,
  last_service_date DATE,
  last_odometer     INT,
  next_due_date     DATE,
  next_due_miles    INT,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Renamed from `truck_documents` (2026-07-21, decisions.md S8/S10) — real
-- upload/display UI added this pass (VehicleDocuments.tsx); schema/RLS shape
-- unchanged, only the name and its FK column.
CREATE TABLE vehicle_documents (
  id             BIGSERIAL PRIMARY KEY,
  vehicle_id     BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
  carrier_org_id BIGINT REFERENCES organizations(id),
  doc_type       TEXT NOT NULL CHECK (doc_type IN (
    'registration','insurance_cert','dot_authority','annual_inspection','other'
  )),
  label          TEXT,
  storage_path   TEXT NOT NULL,
  expiry_date    DATE,
  uploaded_by    UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE org_documents (
  id           BIGSERIAL PRIMARY KEY,
  org_id       BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type     TEXT NOT NULL CHECK (doc_type IN (
    'coi','general_liability','workers_comp','mc_authority',
    'dot_certificate','ucr','w9','business_license'
  )),
  label        TEXT,
  storage_path TEXT NOT NULL,
  expiry_date  DATE,
  uploaded_by  UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Actual CDL/medical-certificate photo scans (2026-07-21, decisions.md S10) --
-- distinct from drivers.cdl_expiry/cdl_class (structured data, already
-- rendered by a stylized CDL-card UI). expiry_date here is informational
-- (what the scan itself says); drivers.cdl_expiry/med_cert_expiry stay the
-- authoritative fields the exceptions system reads.
CREATE TABLE driver_documents (
  id             BIGSERIAL PRIMARY KEY,
  driver_id      BIGINT REFERENCES drivers(id) ON DELETE CASCADE,
  carrier_org_id BIGINT REFERENCES organizations(id),
  doc_type       TEXT NOT NULL CHECK (doc_type IN ('cdl_scan','medical_cert','other')),
  label          TEXT,
  storage_path   TEXT NOT NULL,
  expiry_date    DATE,
  uploaded_by    UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Permanent exception history log (2026-07-21, decisions.md P2 amendment) --
-- distinct from get_exceptions() (SECTION 8), which stays a live computed
-- view for "what's active right now". Writes happen for every tier; only the
-- UI that surfaces this history is Growth+ (has_feature('exception_history')).
CREATE TABLE exception_events (
  id             BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('driver','vehicle','customer','invoice','load')),
  entity_id      BIGINT NOT NULL,       -- polymorphic; no formal FK constraint, matches entity_type
  event_type     TEXT NOT NULL,         -- 'reminder_sent'|'late_delivery'|'dvir_defect'|'doc_expired'|
                                        -- 'invoice_overdue'|'resolved'|'clean_period'|...
  severity       TEXT CHECK (severity IN ('info','warning','urgent')),
  title          TEXT NOT NULL,
  detail         TEXT,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- SECTION 5: SEQUENCES (atomic, race-safe entity number generation)
-- ────────────────────────────────────────────────────────────

CREATE TABLE org_sequences (
  org_id   BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  entity   TEXT NOT NULL,
  last_val BIGINT DEFAULT 0,
  PRIMARY KEY (org_id, entity)
);
-- NOTE: org_sequences RLS lives in SECTION 8 with the other policies — it
-- calls my_org_id(), which is not defined until then.

CREATE OR REPLACE FUNCTION next_entity_val(carrier_org_bigint BIGINT, entity_name TEXT)
RETURNS BIGINT AS $$
DECLARE result BIGINT;
BEGIN
  INSERT INTO org_sequences (org_id, entity, last_val)
  VALUES (carrier_org_bigint, entity_name, 1)
  ON CONFLICT (org_id, entity)
  DO UPDATE SET last_val = org_sequences.last_val + 1
  RETURNING last_val INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Creates a customer (organizations row, type='customer') + its
-- customer_details row atomically, scoped to the caller's own carrier org.
-- SECURITY DEFINER so it can run as one transaction regardless of caller
-- role, while still enforcing the org/role check internally (my_org_id()/
-- my_role() below are defined in SECTION 8). Callable directly via
-- supabase.rpc('create_customer_org', {...}) from web or mobile — no
-- Next.js API layer required for this write.
CREATE OR REPLACE FUNCTION create_customer_org(
  p_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_zip TEXT DEFAULT NULL,
  p_country TEXT DEFAULT 'US',
  p_contact_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE(org_id BIGINT, name TEXT, customer_number TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_org_id  BIGINT := my_org_id();
  v_caller_role    TEXT   := my_role();
  v_new_org_id     BIGINT;
  v_customer_number TEXT;
BEGIN
  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'NO_ORGANIZATION';
  END IF;

  IF v_caller_role NOT IN ('owner','solo','dispatcher') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: name is required';
  END IF;

  INSERT INTO organizations (type, name, phone, email, address, city, state, zip, country)
  VALUES ('customer', p_name, p_phone, p_email, p_address, p_city, p_state, p_zip, COALESCE(p_country, 'US'))
  RETURNING id INTO v_new_org_id;

  v_customer_number := 'C-' || next_entity_val(v_caller_org_id, 'customer');

  INSERT INTO customer_details (org_id, carrier_org_id, customer_number, contact_name, notes)
  VALUES (v_new_org_id, v_caller_org_id, v_customer_number, p_contact_name, p_notes);

  RETURN QUERY SELECT v_new_org_id, p_name, v_customer_number;
END;
$$;

-- Customer editing (0034): a carrier has no direct RLS write access to a
-- customer org's own `organizations` row (owner_solo_org_update only covers
-- your OWN org), so this needs the same SECURITY DEFINER shape as
-- create_customer_org above. Updates organizations + customer_details
-- atomically; COALESCE means "not provided" leaves a field unchanged.
-- p_set_contact_name/p_set_notes distinguish "omitted" from "explicitly
-- cleared to NULL" for those two nullable columns.
CREATE OR REPLACE FUNCTION update_customer_org(
  p_customer_org_id BIGINT,
  p_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_zip TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_contact_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_set_contact_name BOOLEAN DEFAULT false,
  p_set_notes BOOLEAN DEFAULT false
)
RETURNS TABLE(org_id BIGINT, name TEXT, customer_number TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_org_id  BIGINT := my_org_id();
  v_caller_role    TEXT   := my_role();
  v_customer_number TEXT;
BEGIN
  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'NO_ORGANIZATION';
  END IF;

  IF v_caller_role NOT IN ('owner','solo','dispatcher') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- Table alias required: `customer_number` collides with this function's
  -- own RETURNS TABLE column name, which plpgsql cannot otherwise disambiguate.
  SELECT cd.customer_number INTO v_customer_number
  FROM customer_details cd
  WHERE cd.org_id = p_customer_org_id AND cd.carrier_org_id = v_caller_org_id;

  IF v_customer_number IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF p_name IS NOT NULL AND length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: name cannot be blank';
  END IF;

  -- `organizations.name` qualified: bare `name` is ambiguous against this
  -- function's own RETURNS TABLE column of the same name.
  UPDATE organizations SET
    name    = COALESCE(p_name, organizations.name),
    phone   = COALESCE(p_phone, phone),
    email   = COALESCE(p_email, email),
    address = COALESCE(p_address, address),
    city    = COALESCE(p_city, city),
    state   = COALESCE(p_state, state),
    zip     = COALESCE(p_zip, zip),
    country = COALESCE(p_country, country)
  WHERE id = p_customer_org_id;

  -- `org_id` qualified: same RETURNS TABLE shadowing issue.
  UPDATE customer_details SET
    contact_name = CASE WHEN p_set_contact_name THEN p_contact_name ELSE contact_name END,
    notes        = CASE WHEN p_set_notes THEN p_notes ELSE notes END
  WHERE customer_details.org_id = p_customer_org_id;

  RETURN QUERY SELECT o.id, o.name, v_customer_number FROM organizations o WHERE o.id = p_customer_org_id;
END;
$$;

-- Bulk customer import (PRD: "Bulk customer import via CSV or XLS... Max 50
-- customers per import for MVP"). Client parses the CSV and sends parsed
-- rows as JSONB, each with an explicit per-row `action` decided in the
-- preview step ('create' default, or 'skip'/'overwrite' when the client's
-- own duplicate check found a name match) — the function trusts that
-- decision rather than re-deciding server-side, so what the user saw in the
-- preview is exactly what happens. Duplicate matching (case-insensitive
-- name, scoped to the caller's own customers) still happens here too,
-- purely as a safety net against a stale preview (e.g. two browser tabs) --
-- an 'overwrite' against a name that no longer matches any existing
-- customer silently falls back to 'create' rather than erroring the whole
-- batch.
CREATE OR REPLACE FUNCTION bulk_import_customers(p_rows JSONB)
RETURNS TABLE(row_name TEXT, row_action TEXT, customer_number TEXT, org_id BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_org_id   BIGINT := my_org_id();
  v_caller_role     TEXT   := my_role();
  v_row             JSONB;
  v_name            TEXT;
  v_requested_action TEXT;
  v_existing_org_id BIGINT;
  v_new_org_id      BIGINT;
  v_customer_number TEXT;
BEGIN
  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'NO_ORGANIZATION';
  END IF;

  IF v_caller_role NOT IN ('owner','solo','dispatcher') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) != 'array' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: rows must be an array';
  END IF;

  IF jsonb_array_length(p_rows) = 0 OR jsonb_array_length(p_rows) > 50 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: 1-50 rows per import';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_name := trim(COALESCE(v_row->>'name', ''));

    IF length(v_name) = 0 THEN
      row_name := v_row->>'name'; row_action := 'skipped_missing_name';
      customer_number := NULL; org_id := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT o.id INTO v_existing_org_id
    FROM organizations o
    JOIN customer_details cd ON cd.org_id = o.id
    WHERE cd.carrier_org_id = v_caller_org_id AND lower(o.name) = lower(v_name)
    LIMIT 1;

    v_requested_action := COALESCE(v_row->>'action', 'create');

    IF v_existing_org_id IS NOT NULL AND v_requested_action = 'skip' THEN
      row_name := v_name; row_action := 'skipped_duplicate';
      org_id := v_existing_org_id; customer_number := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_existing_org_id IS NOT NULL AND v_requested_action = 'overwrite' THEN
      UPDATE organizations SET
        phone = COALESCE(NULLIF(trim(v_row->>'phone'), ''), phone),
        email = COALESCE(NULLIF(trim(v_row->>'email'), ''), email)
      WHERE id = v_existing_org_id;

      UPDATE customer_details SET
        contact_name = COALESCE(NULLIF(trim(v_row->>'contact_name'), ''), contact_name)
      WHERE org_id = v_existing_org_id
      RETURNING customer_details.customer_number INTO v_customer_number;

      row_name := v_name; row_action := 'overwritten';
      org_id := v_existing_org_id; customer_number := v_customer_number;
      RETURN NEXT;
      CONTINUE;
    END IF;

    INSERT INTO organizations (type, name, phone, email)
    VALUES ('customer', v_name, NULLIF(trim(v_row->>'phone'), ''), NULLIF(trim(v_row->>'email'), ''))
    RETURNING id INTO v_new_org_id;

    v_customer_number := 'C-' || next_entity_val(v_caller_org_id, 'customer');

    INSERT INTO customer_details (org_id, carrier_org_id, customer_number, contact_name)
    VALUES (v_new_org_id, v_caller_org_id, v_customer_number, NULLIF(trim(v_row->>'contact_name'), ''));

    row_name := v_name; row_action := 'created';
    org_id := v_new_org_id; customer_number := v_customer_number;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- SECTION 6: DRIVER-SAFE VIEW
-- ────────────────────────────────────────────────────────────

CREATE VIEW loads_driver_view AS
SELECT
  id, load_number, carrier_org_id, customer_org_id, customer_name_raw,
  driver_id, vehicle_id,
  pickup_address, pickup_city, pickup_state, pickup_zip, pickup_lat, pickup_lng,
  delivery_address, delivery_city, delivery_state, delivery_zip, delivery_lat, delivery_lng,
  total_miles, pickup_date, pickup_time, delivery_date, delivery_time,
  commodity, weight_lbs,
  -- rate intentionally excluded
  status, intake_method,
  tracking_token, last_location_lat, last_location_lng, last_location_at,
  created_at, updated_at
FROM loads;

-- CRITICAL (fixed 2026-07-20): without security_invoker a view runs with its
-- OWNER's privileges, so RLS on `loads` was never evaluated — every driver
-- could read AND write every load in every carrier org, and this view is the
-- live mobile driver path. Simple views are auto-updatable, so writes passed
-- through too. Never drop this setting.
ALTER VIEW loads_driver_view SET (security_invoker = on);
-- Drivers read through the view; status writes go to the base `loads` table.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON loads_driver_view FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON loads_driver_view FROM anon;

-- ────────────────────────────────────────────────────────────
-- SECTION 7: INDEXES
-- ────────────────────────────────────────────────────────────

CREATE INDEX idx_orgs_type              ON organizations(type);
CREATE INDEX idx_customer_details_carrier ON customer_details(carrier_org_id);
CREATE INDEX idx_profiles_org           ON profiles(org_id);
CREATE INDEX idx_vehicles_carrier       ON vehicles(carrier_org_id);
CREATE INDEX idx_drivers_carrier        ON drivers(carrier_org_id);
CREATE INDEX idx_drivers_profile        ON drivers(profile_id);
CREATE INDEX idx_loads_carrier          ON loads(carrier_org_id);
CREATE INDEX idx_loads_customer         ON loads(customer_org_id);
CREATE INDEX idx_loads_driver           ON loads(driver_id);
CREATE INDEX idx_loads_status           ON loads(status);
CREATE INDEX idx_loads_tracking         ON loads(tracking_token);
CREATE INDEX idx_load_events_load       ON load_events(load_id);
CREATE INDEX idx_invoices_carrier       ON invoices(carrier_org_id);
CREATE INDEX idx_invoices_customer      ON invoices(customer_org_id);
CREATE INDEX idx_invoices_load          ON invoices(load_id);
CREATE INDEX idx_dvir_vehicle           ON dvir_inspections(vehicle_id);
CREATE INDEX idx_dvir_driver            ON dvir_inspections(driver_id);
CREATE INDEX idx_service_vehicle        ON service_logs(vehicle_id);
CREATE INDEX idx_vehicle_docs_vehicle   ON vehicle_documents(vehicle_id);
CREATE INDEX idx_org_docs               ON org_documents(org_id);
CREATE INDEX idx_driver_docs_driver     ON driver_documents(driver_id);
CREATE INDEX idx_exception_events_entity ON exception_events(entity_type, entity_id);
CREATE INDEX idx_fuel_stops_carrier       ON fuel_stops(carrier_org_id);
CREATE INDEX idx_fuel_stops_vehicle       ON fuel_stops(vehicle_id);
CREATE INDEX idx_fuel_stops_load          ON fuel_stops(load_id);
CREATE INDEX idx_load_expenses_load       ON load_expenses(load_id);
CREATE INDEX idx_ifta_crossings_carrier   ON ifta_state_crossings(carrier_org_id);
CREATE INDEX idx_ifta_crossings_load      ON ifta_state_crossings(load_id);
CREATE INDEX idx_driver_messages_load     ON driver_messages(load_id);
CREATE INDEX idx_driver_message_translations_message ON driver_message_translations(message_id);
CREATE INDEX idx_driver_settlements_carrier ON driver_settlements(carrier_org_id);
CREATE INDEX idx_driver_settlements_driver  ON driver_settlements(driver_id);
CREATE INDEX idx_settlement_deductions_settlement ON settlement_deductions(settlement_id);

CREATE UNIQUE INDEX idx_customer_number ON customer_details(carrier_org_id, customer_number) WHERE customer_number IS NOT NULL;
CREATE UNIQUE INDEX idx_driver_number   ON drivers(carrier_org_id, driver_number)            WHERE driver_number   IS NOT NULL;
CREATE UNIQUE INDEX idx_vehicle_number  ON vehicles(carrier_org_id, vehicle_number)           WHERE vehicle_number  IS NOT NULL;

-- Public tracking lookup (decision R2, /track/[token]). Explicit column
-- allowlist — never rate/driver_id/financials. SECURITY DEFINER so it can
-- also read the carrier's org name/phone: organizations has NO anon SELECT
-- policy at all (by design, see SECTION 8), so this RPC is the one
-- sanctioned way to expose a carrier's public-facing contact info to a
-- tracking-link visitor. Do not add a general anon policy on organizations
-- instead — that would expose it more broadly than just via a valid token.
--
-- This is the BASIC version (pre-branding). Migration 0026 (decisions.md
-- PR1 amendment) replaces this definition further down (SECTION 19, right
-- after entitlement_decision is defined) with one that also returns
-- brand_logo_path/brand_primary_color/brand_accent_color — deliberately
-- placed after, not edited in place here, for the same reason has_feature()
-- itself has an early definition and a later CREATE OR REPLACE below: a
-- LANGUAGE SQL function body IS resolved against its referenced objects at
-- CREATE time (unlike PL/pgSQL), so a get_public_tracking() defined THIS
-- early that already called entitlement_decision() (not defined until much
-- later in this file) would fail a fresh top-to-bottom replay even though
-- it works fine applied incrementally through supabase/migrations, where
-- entitlement_decision already exists by migration 0026's turn. Confirmed
-- by running node scripts/db/verify-migrations.mjs, which replays this file
-- alone into a scratch database.
CREATE OR REPLACE FUNCTION get_public_tracking(p_token TEXT)
RETURNS TABLE(
  load_number       TEXT,
  status            TEXT,
  pickup_city       TEXT,
  pickup_state      TEXT,
  delivery_city     TEXT,
  delivery_state    TEXT,
  pickup_date       DATE,
  delivery_date     DATE,
  last_location_lat NUMERIC,
  last_location_lng NUMERIC,
  last_location_at  TIMESTAMPTZ,
  carrier_name      TEXT,
  carrier_phone     TEXT,
  carrier_email     TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    l.load_number, l.status,
    l.pickup_city, l.pickup_state, l.delivery_city, l.delivery_state,
    l.pickup_date, l.delivery_date,
    l.last_location_lat, l.last_location_lng, l.last_location_at,
    o.name, o.phone, o.email
  FROM loads l
  JOIN organizations o ON o.id = l.carrier_org_id
  WHERE l.tracking_token = p_token
$$;

GRANT EXECUTE ON FUNCTION get_public_tracking(TEXT) TO anon;

-- Public tracking timeline (decision R2, /track/[token]). Companion to
-- get_public_tracking() above -- same token-scoped SECURITY DEFINER pattern.
-- load_events.note is free-text internal driver/dispatcher commentary and
-- must NEVER be exposed here, and created_by must never be exposed either
-- (it's a profiles.id FK, effectively identifying an internal user to an
-- anonymous public visitor). Only event_type + created_at are returned.
-- anon has NO direct SELECT on load_events (see carrier_load_events_select
-- policy) -- this function is the one sanctioned way to expose timeline
-- history to a tracking-link visitor. Do not add an anon policy on
-- load_events instead.
CREATE OR REPLACE FUNCTION get_public_tracking_events(p_token TEXT)
RETURNS TABLE(
  event_type TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT e.event_type, e.created_at
  FROM load_events e
  JOIN loads l ON l.id = e.load_id
  WHERE l.tracking_token = p_token
  ORDER BY e.created_at ASC
$$;

GRANT EXECUTE ON FUNCTION get_public_tracking_events(TEXT) TO anon;

-- ────────────────────────────────────────────────────────────
-- SECTION 8: ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

-- Helper functions: SECURITY DEFINER bypasses RLS on profiles, so policies
-- that need the caller's org_id/role can call these instead of subquerying
-- profiles directly. Required wherever a table's RLS policy needs data from
-- profiles AND profiles' own policy needs data from that same table — a
-- direct subquery cycle in that case throws "infinite recursion detected in
-- policy for relation" (hit between profiles <-> customer_details).
-- Both return NULL for a deactivated profile (is_active = false), which
-- denies every policy built on these two helpers -- see the is_active
-- comment on the profiles table for what this does and doesn't cover.
CREATE OR REPLACE FUNCTION my_org_id()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid() AND is_active = true
$$;

CREATE OR REPLACE FUNCTION my_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid() AND is_active = true
$$;

-- The caller's drivers.id, or NULL when they are not a driver or their profile is deactivated (migration 0022).
-- Policies used to subquery drivers directly, which ignored profiles.is_active; this is the driver-side twin of
-- my_org_id()/my_role().
CREATE OR REPLACE FUNCTION my_driver_id()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT d.id FROM drivers d JOIN profiles p ON p.id = d.profile_id WHERE p.id = auth.uid() AND p.is_active = true
$$;

-- Tier entitlements gate (2026-07-21, decisions.md S11) — real, RLS-usable
-- function (same idiom as my_org_id()/my_role() above, not just an app-layer
-- JS helper), so any future tier-gated table's RLS policy can reference
-- has_feature('driver_chat') directly. Must be defined here, after
-- my_org_id() — placing it near tiers/features in SECTION 1b would break a
-- fresh schema replay with "function my_org_id() does not exist".
CREATE OR REPLACE FUNCTION has_feature(feature_key TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT rank FROM tiers WHERE code = (
            SELECT tier FROM carrier_details WHERE org_id = my_org_id()
          ))
         >=
         (SELECT rank FROM tiers WHERE code = (
            SELECT min_tier FROM features WHERE key = feature_key
          ));
$$;
GRANT EXECUTE ON FUNCTION has_feature TO authenticated;

-- Added 2026-07-21 -- the user's explicit architecture directive: which
-- menus/actions are enabled must be driven ENTIRELY by the features/tiers
-- data model, never by hardcoded tier-string checks or a feature list baked
-- into app code. has_feature() only answers "is this ONE key unlocked?" --
-- every UI surface that wants to conditionally render a menu/action would
-- otherwise need its own per-item round trip with a hardcoded key. This
-- companion function returns the FULL set of feature keys the caller's org
-- currently has, in one call, so nav/menu-building code can fetch it once
-- and render entirely from data (`entitlements.has('driver_chat')`) rather
-- than re-deriving tier logic per component. Same rank-comparison logic as
-- has_feature(), just against every features row instead of one.
CREATE OR REPLACE FUNCTION get_my_entitlements()
RETURNS TABLE(key TEXT)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT f.key
  FROM features f
  WHERE (SELECT rank FROM tiers WHERE code = (
           SELECT tier FROM carrier_details WHERE org_id = my_org_id()
         ))
        >=
        (SELECT rank FROM tiers WHERE code = f.min_tier);
$$;
GRANT EXECUTE ON FUNCTION get_my_entitlements TO authenticated;

-- Phase 7C (2026-07-21) -- IFTA functions, defined here for the same reason
-- as has_feature(): they call my_org_id(), so they must come after it.
-- check_ifta_completeness() implements BR-22's 60% GPS-completeness
-- threshold; called wherever a load transitions to 'delivered' (business
-- logic deferred to that call site, not implemented here yet).
CREATE OR REPLACE FUNCTION check_ifta_completeness(p_load_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT SUM(odometer_est) FROM ifta_state_crossings WHERE load_id = p_load_id), 0
  ) >= 0.6 * COALESCE((SELECT total_miles FROM loads WHERE id = p_load_id), 0);
$$;
GRANT EXECUTE ON FUNCTION check_ifta_completeness TO authenticated;

-- Growth+ (miles by state, no tax math).
CREATE OR REPLACE FUNCTION get_ifta_quarterly_summary(p_carrier_org_id BIGINT, p_quarter TEXT)
RETURNS TABLE(state TEXT, total_miles NUMERIC) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.state, SUM(c.odometer_est)::NUMERIC
  FROM ifta_state_crossings c
  WHERE c.carrier_org_id = p_carrier_org_id
    AND p_carrier_org_id = my_org_id()
    AND to_char(c.crossed_at, '"Q"Q') = split_part(p_quarter, '-', 2)
    AND to_char(c.crossed_at, 'YYYY') = split_part(p_quarter, '-', 1)
  GROUP BY c.state;
$$;
GRANT EXECUTE ON FUNCTION get_ifta_quarterly_summary TO authenticated;

-- Pro+ only -- caller must check has_feature('ifta_tax_hub') before relying
-- on these numbers; the function computes correctly regardless of tier
-- (enforcement lives at the API-route/page level, not by lying about the
-- math here). Implements the exact net-tax-due formula confirmed identically
-- across three mockups:
--   net_tax_due = (miles_in_state / total_miles * total_fuel_used * state_rate)
--                 - (fuel_purchased_in_state * state_rate)
CREATE OR REPLACE FUNCTION get_ifta_tax_summary(p_carrier_org_id BIGINT, p_quarter TEXT)
RETURNS TABLE(state TEXT, miles_in_state NUMERIC, net_tax_due NUMERIC) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_miles NUMERIC;
  v_total_fuel  NUMERIC;
BEGIN
  IF p_carrier_org_id != my_org_id() THEN
    RETURN;
  END IF;

  SELECT SUM(c.odometer_est) INTO v_total_miles
  FROM ifta_state_crossings c WHERE c.carrier_org_id = p_carrier_org_id;

  SELECT SUM(f.gallons) INTO v_total_fuel
  FROM fuel_stops f WHERE f.carrier_org_id = p_carrier_org_id;

  RETURN QUERY
  SELECT
    c.state,
    SUM(c.odometer_est)::NUMERIC AS miles_in_state,
    (
      (SUM(c.odometer_est) / NULLIF(v_total_miles, 0)) * COALESCE(v_total_fuel, 0) *
        COALESCE((SELECT rate_per_gallon FROM ifta_tax_rates WHERE ifta_tax_rates.state = c.state AND quarter = p_quarter), 0)
      -
      COALESCE((SELECT SUM(f2.gallons) FROM fuel_stops f2 WHERE f2.carrier_org_id = p_carrier_org_id AND f2.state = c.state), 0)
        * COALESCE((SELECT rate_per_gallon FROM ifta_tax_rates WHERE ifta_tax_rates.state = c.state AND quarter = p_quarter), 0)
    )::NUMERIC AS net_tax_due
  FROM ifta_state_crossings c
  WHERE c.carrier_org_id = p_carrier_org_id
  GROUP BY c.state;
END;
$$;
GRANT EXECUTE ON FUNCTION get_ifta_tax_summary TO authenticated;

-- GLOBAL MASTER DATA — read-only reference tables, no org scoping, no
-- app-writable policy (closed sets, changed only via schema.sql + redeploy).
ALTER TABLE vehicle_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicle_types_select" ON vehicle_types FOR SELECT TO authenticated USING (true);

ALTER TABLE vehicle_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicle_classifications_select" ON vehicle_classifications FOR SELECT TO authenticated USING (true);

ALTER TABLE vehicle_type_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicle_type_classifications_select" ON vehicle_type_classifications FOR SELECT TO authenticated USING (true);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles_select" ON roles FOR SELECT TO authenticated USING (true);

ALTER TABLE role_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_capabilities_select" ON role_capabilities FOR SELECT TO authenticated USING (true);

ALTER TABLE languages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "languages_select" ON languages FOR SELECT TO authenticated USING (true);
-- Also readable by logged-out visitors: LanguageSwitcher renders on /login
-- (decisions.md L4 — pick a language before you can even authenticate),
-- and SECTION 8c's blanket base-table GRANT only covers
-- authenticated/service_role, so anon needs both its own RLS policy and
-- its own base SELECT grant (see SECTION 8c's note on that gotcha).
CREATE POLICY "languages_select_anon" ON languages FOR SELECT TO anon USING (true);
GRANT SELECT ON languages TO anon;

ALTER TABLE tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tiers_select" ON tiers FOR SELECT TO authenticated USING (true);
-- Public plan picker on the self-serve signup page (unauthenticated) needs to
-- read tier pricing -- same anon-access shape as languages_select_anon above
-- (public catalog data, no tenant secrets, so anon SELECT is safe).
CREATE POLICY "tiers_select_anon" ON tiers FOR SELECT TO anon USING (true);
GRANT SELECT ON tiers TO anon;

ALTER TABLE features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "features_select" ON features FOR SELECT TO authenticated USING (true);

ALTER TABLE ifta_tax_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ifta_tax_rates_select" ON ifta_tax_rates FOR SELECT TO authenticated USING (true);

-- ORGANIZATIONS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
-- No client INSERT policy: tenants are created only by the server (onboarding, service role). Migration 0019.
-- Covers: (a) reading your own org, (b) if you're a customer-portal user,
-- reading your carrier's org.
CREATE POLICY "org_member_select" ON organizations FOR SELECT USING (
  id = my_org_id()
  OR id IN (SELECT carrier_org_id FROM customer_details WHERE org_id = my_org_id())
);
-- The reverse direction: a carrier reading the org rows of its OWN
-- customers. Without this, any query embedding organizations(...) from
-- customer_details (e.g. GET /api/customers) silently drops every row —
-- PostgREST embeds are effectively inner joins, so an RLS-blocked embedded
-- row removes the whole outer row, not just the embedded field.
CREATE POLICY "carrier_reads_own_customer_orgs" ON organizations FOR SELECT USING (
  type = 'customer' AND id IN (SELECT org_id FROM customer_details WHERE carrier_org_id = my_org_id())
);
CREATE POLICY "owner_solo_org_update" ON organizations FOR UPDATE USING (
  id = my_org_id()
  AND my_role() IN ('owner','solo')
);

-- CARRIER DETAILS
ALTER TABLE carrier_details ENABLE ROW LEVEL SECURITY;
-- Read-only to clients: tier/billing state is written only by the server (migration 0019, see SECTION 19).
CREATE POLICY "carrier_details_select" ON carrier_details FOR SELECT USING (
  org_id = my_org_id()
);

-- CUSTOMER DETAILS
-- NOTE: uses my_org_id()/my_role() (not a direct profiles subquery) because
-- profiles' own SELECT policy below queries customer_details — a direct
-- subquery cycle here would recurse into that policy and back again.
ALTER TABLE customer_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_customer_select" ON customer_details FOR SELECT USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher','finance')
);
CREATE POLICY "carrier_customer_write" ON customer_details FOR ALL USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')
);

-- CUSTOMER CONTACTS (Phase 3H) -- carrier staff manage the list; a portal
-- contact can read (not write) their own row, matching this app's existing
-- "portal roles are read-only" convention (customer_loads_select/
-- customer_invoices_select are both SELECT-only for the same reason).
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_customer_contacts_select" ON customer_contacts FOR SELECT USING (
  carrier_org_id = my_org_id()
);
CREATE POLICY "carrier_customer_contacts_write" ON customer_contacts FOR ALL USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')
);
CREATE POLICY "portal_contact_own_row_select" ON customer_contacts FOR SELECT USING (
  portal_profile_id = auth.uid()
);

-- PROFILES
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "same_org_profiles_select" ON profiles FOR SELECT USING (
  org_id = my_org_id()
  OR org_id IN (SELECT org_id FROM customer_details WHERE carrier_org_id = my_org_id())
);
-- Recovered from the live database 2026-07-26: this policy existed in the
-- running DB but had never been written back into this file, so the next
-- replay/`db reset` would have silently dropped it. Functionally it is a
-- subset of same_org_profiles_select above (a user's own row always shares
-- their org), so nothing depended on it — but a self-read that only works via
-- the org-wide policy breaks the moment my_org_id() returns NULL, which is
-- exactly the state a freshly-signed-up user is in before onboarding writes
-- their profile. Kept as an explicit, independent path to your own row.
CREATE POLICY "users_read_own_profile" ON profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);
-- ORG SEQUENCES
-- CRITICAL (fixed 2026-07-20): this was the ONLY public table with RLS off,
-- while `authenticated` held full grants — any carrier could read another
-- carrier's load/truck/driver counts (a business-intelligence leak) and
-- corrupt their numbering so the next allocation collides or jumps.
-- next_entity_val() is SECURITY INVOKER, so it needs this own-org policy to
-- keep working; service_role bypasses RLS as before.
ALTER TABLE org_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_sequences_own_org" ON org_sequences FOR ALL TO authenticated
  USING (org_id = my_org_id()) WITH CHECK (org_id = my_org_id());

-- CRITICAL (fixed 2026-07-20): this had USING but no WITH CHECK, so USING
-- doubled as the check and neither role nor org_id was pinned — any user could
-- promote themselves to owner and/or move into another tenant. Uses
-- my_role()/my_org_id() (SECURITY DEFINER) rather than subquerying profiles,
-- which would reintroduce the recursive-RLS bug. In READ COMMITTED the helpers
-- see the pre-UPDATE row, so this compares proposed vs. current values.
CREATE POLICY "own_profile_update" ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = my_role() AND org_id = my_org_id());
-- No client INSERT policy: profiles are created only by the server (onboarding/invites, service role). 0019.

-- LOADS
ALTER TABLE loads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_solo_loads_all" ON loads FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);
CREATE POLICY "dispatcher_loads_select" ON loads FOR SELECT USING (
  carrier_org_id = my_org_id()
  AND my_role() = 'dispatcher'
);
-- Tightened 2026-07-20: WITH CHECK (true) let the new row be anything,
-- including a different carrier_org_id (move a load to another tenant).
-- Denial happened to emerge from policy interaction; now it is explicit.
CREATE POLICY "dispatcher_loads_update" ON loads FOR UPDATE TO authenticated
  USING (carrier_org_id = my_org_id() AND my_role() = 'dispatcher')
  WITH CHECK (carrier_org_id = my_org_id() AND my_role() = 'dispatcher');

-- Added 2026-07-20 (audit finding 5): dispatcher had SELECT and UPDATE but no
-- INSERT — the persona whose entire job is load intake could not create one.
CREATE POLICY "dispatcher_loads_insert" ON loads FOR INSERT TO authenticated
  WITH CHECK (carrier_org_id = my_org_id() AND my_role() = 'dispatcher');

-- Added 2026-07-20 (audit finding 8): finance could create an invoice but not
-- advance the load to 'invoiced'/'paid' — a silent UPDATE 0, which made the
-- invoice flow look like it worked while the load never moved.
CREATE POLICY "finance_loads_update" ON loads FOR UPDATE TO authenticated
  USING (carrier_org_id = my_org_id() AND my_role() = 'finance')
  WITH CHECK (carrier_org_id = my_org_id() AND my_role() = 'finance');
CREATE POLICY "finance_loads_select" ON loads FOR SELECT USING (
  carrier_org_id = my_org_id()
  AND my_role() = 'finance'
);
CREATE POLICY "driver_own_loads_select" ON loads FOR SELECT USING (
  driver_id = my_driver_id()
);
CREATE POLICY "driver_loads_update_status" ON loads FOR UPDATE USING (
  driver_id = my_driver_id()
) WITH CHECK (true);
-- Explicit is_active check (2026-07-21, Phase 3H) -- this policy predates
-- my_org_id()/my_role() and subqueries profiles directly, so patching those
-- two helpers for deactivated-portal-contact revocation doesn't reach it on
-- its own; added here by hand since this is exactly the policy that gates
-- what a revoked customer_contacts.portal_profile_id can still see.
CREATE POLICY "customer_loads_select" ON loads FOR SELECT USING (
  customer_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid() AND is_active = true)
  AND (SELECT role FROM profiles WHERE id = auth.uid() AND is_active = true) IN ('customer_admin','customer_viewer')
);
-- REMOVED 2026-07-20 (audit finding): this had no token equality check at
-- all -- USING (tracking_token IS NOT NULL) -- inert only because `anon` has
-- no SELECT grant on loads. The moment anyone grants that for any unrelated
-- reason, every load in every org leaks to unauthenticated callers. The
-- public tracking page (app/track/[token]/page.tsx) never queries `loads`
-- directly anyway -- it goes through get_public_tracking(p_token), a
-- SECURITY DEFINER RPC with an explicit column allowlist. Do not re-add a
-- broad anon policy here; extend that RPC instead.

-- INVOICES
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing_invoices_all" ON invoices FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo','finance')
);
-- Explicit is_active check, same reasoning as customer_loads_select above.
CREATE POLICY "customer_invoices_select" ON invoices FOR SELECT USING (
  customer_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid() AND is_active = true)
  AND (SELECT role FROM profiles WHERE id = auth.uid() AND is_active = true) IN ('customer_admin','customer_viewer')
);

-- FUEL STOPS & LOAD EXPENSES (Phase 7B, 2026-07-21) -- finance is read-only,
-- same rate-confidentiality precedent as elsewhere (no insert/edit for them).
ALTER TABLE fuel_stops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_fuel_stops_select" ON fuel_stops FOR SELECT TO authenticated USING (
  carrier_org_id = my_org_id()
);
CREATE POLICY "driver_fuel_stops_insert" ON fuel_stops FOR INSERT TO authenticated WITH CHECK (
  carrier_org_id = my_org_id() AND driver_id = my_driver_id()
);
CREATE POLICY "owner_solo_dispatcher_fuel_stops_all" ON fuel_stops FOR ALL TO authenticated USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')
);

ALTER TABLE load_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_load_expenses_select" ON load_expenses FOR SELECT TO authenticated USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher','finance')
);
CREATE POLICY "owner_solo_dispatcher_load_expenses_all" ON load_expenses FOR ALL TO authenticated USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')
);

-- IFTA (Phase 7C, 2026-07-21)
ALTER TABLE ifta_state_crossings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_ifta_crossings_select" ON ifta_state_crossings FOR SELECT TO authenticated USING (
  carrier_org_id = my_org_id()
);
CREATE POLICY "driver_ifta_crossings_insert" ON ifta_state_crossings FOR INSERT TO authenticated WITH CHECK (
  carrier_org_id = my_org_id() AND driver_id = my_driver_id()
);
CREATE POLICY "owner_solo_dispatcher_ifta_crossings_all" ON ifta_state_crossings FOR ALL TO authenticated USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')
);

-- DRIVER MESSAGES (Phase 7D, 2026-07-21) -- Finance gets ZERO access per
-- BR-2/FR-119, not even SELECT -- no policy below grants finance anything.
ALTER TABLE driver_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "driver_thread_messages_select" ON driver_messages FOR SELECT TO authenticated USING (
  carrier_org_id = my_org_id()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = my_driver_id())
);
CREATE POLICY "driver_thread_messages_insert" ON driver_messages FOR INSERT TO authenticated WITH CHECK (
  carrier_org_id = my_org_id()
  AND sender_id = auth.uid()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = my_driver_id())
);
CREATE POLICY "driver_thread_messages_update" ON driver_messages FOR UPDATE TO authenticated USING (
  carrier_org_id = my_org_id()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = my_driver_id())
) WITH CHECK (
  carrier_org_id = my_org_id()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = my_driver_id())
);
-- Drivers may only flip read_at on an update: trigger driver_messages_columns (SECTION 20, migration 0020).
CREATE POLICY "owner_solo_dispatcher_messages_all" ON driver_messages FOR ALL TO authenticated USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')
);

ALTER TABLE driver_message_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "same_org_message_translations_select" ON driver_message_translations FOR SELECT TO authenticated USING (
  message_id IN (SELECT id FROM driver_messages WHERE carrier_org_id = my_org_id())
);
-- Found missing while adding test coverage (2026-07-22): only a SELECT
-- policy existed, so app/api/driver-messages/[id]/translate/route.ts's own
-- insert (using the caller's RLS-scoped session, not the admin client) 500'd
-- for every real caller — the translate feature was completely broken
-- end-to-end, not just untested. Same org-scoping shape as the SELECT
-- policy; the route's own explicit role/assigned-driver check (mirroring
-- app/api/team/[id]/route.ts's convention) is the finer-grained gate, RLS is
-- the backstop.
CREATE POLICY "same_org_message_translations_insert" ON driver_message_translations FOR INSERT TO authenticated WITH CHECK (
  message_id IN (SELECT id FROM driver_messages WHERE carrier_org_id = my_org_id())
);

-- DRIVER SETTLEMENTS (Phase 7E, 2026-07-21) -- driver sees only their own;
-- dispatcher has NO access (financial, outside dispatcher's scope per the
-- role table).
ALTER TABLE driver_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "driver_own_settlements_select" ON driver_settlements FOR SELECT TO authenticated USING (
  driver_id = my_driver_id()
);
CREATE POLICY "owner_solo_finance_settlements_all" ON driver_settlements FOR ALL TO authenticated USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','finance')
);

ALTER TABLE settlement_deductions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "same_org_settlement_deductions_select" ON settlement_deductions FOR SELECT TO authenticated USING (
  settlement_id IN (
    SELECT ds.id FROM driver_settlements ds
    WHERE ds.carrier_org_id = my_org_id()
       OR ds.driver_id = my_driver_id()
  )
);
CREATE POLICY "owner_solo_finance_settlement_deductions_all" ON settlement_deductions FOR ALL TO authenticated USING (
  settlement_id IN (SELECT id FROM driver_settlements WHERE carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','finance'))
);

-- Opportunistic overdue-invoice housekeeping. There is no cron/job scheduler
-- in this project yet, so this is called from the /invoices list page's
-- server component on every load (see app/(app)/invoices/page.tsx) as a
-- pragmatic stopgap rather than a real scheduled job. Replace with a real
-- schedule (Supabase's pg_cron extension, or a Vercel Cron hitting an API
-- route) once the project has a home for scheduled jobs.
-- SECURITY DEFINER so any org member viewing invoices can trigger it
-- regardless of role, but SECURITY DEFINER bypasses RLS entirely — so the
-- UPDATE is explicitly scoped to the caller's own org via my_org_id() to
-- avoid touching every carrier's invoices system-wide.
CREATE OR REPLACE FUNCTION mark_overdue_invoices()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE invoices SET status = 'overdue'
  WHERE status = 'sent' AND due_date < CURRENT_DATE
    AND carrier_org_id = my_org_id();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION mark_overdue_invoices() TO authenticated;

-- Phase 6 foundation (management-by-exception, decisions.md P2 amendment/S11):
-- get_exceptions() is the live, ungated exception-DETECTION query -- per the
-- P2 amendment, detection stays visible at every tier; only a future UI's
-- truncated-vs-full inbox presentation is tier-gated, so no has_feature()
-- check belongs inside this function. Distinct from exception_events (SECTION
-- 3), which is the permanent write-log of what already fired; this is "what's
-- active right now," computed fresh from source tables on every call.
--
-- entity_type/title/detail follow the same "DB label is never rendered
-- directly" rule as roles.label/vehicle_types.label (S9) -- title/detail here
-- are English dev-fallback only; real UI renders via message-catalog t() keys
-- keyed off exception_type, not these strings.
--
-- tier thresholds (today = overdue/expired; this_week = due within 7 days;
-- upcoming = due within a longer, per-type horizon) are per-branch below --
-- see each branch's comment for why its horizon was chosen.
--
-- NOTE on driver_documents: deliberately NOT a source here. Its expiry_date is
-- the scan's own informational date -- the schema comment on driver_documents
-- (SECTION 3) is explicit that drivers.cdl_expiry/med_cert_expiry are the
-- authoritative fields this system reads, so the cdl_expiring/med_cert_expiring
-- branches below read those columns directly, not driver_documents.
--
-- NOTE on maintenance_reminders: only next_due_date-based rows are included.
-- next_due_miles exists but there is no live current-odometer feed anywhere
-- in the schema to compare it against (vehicles has no odometer column;
-- service_logs/dvir_inspections/fuel_stops odometer readings are point-in-time
-- logs, not a maintained "current mileage"), so a mileage-only reminder with
-- next_due_date IS NULL cannot be tiered from available data and is skipped
-- rather than guessed at.
--
-- NOTE on org_documents' entity_type: exception_events.entity_type's CHECK
-- list (driver/vehicle/customer/invoice/load) has no 'organization' value,
-- and org_documents.org_id here is always the caller's OWN carrier org (per
-- its RLS policy: org_id = caller's profiles.org_id) -- not a customer org.
-- 'customer' is used as the closest available stand-in for "an
-- organizations-table row" since that's the only entity_type backed by the
-- organizations table. Revisit if entity_type's CHECK list ever grows an
-- 'organization' value.
CREATE OR REPLACE FUNCTION get_exceptions()
RETURNS TABLE(
  entity_type    TEXT,
  entity_id      BIGINT,
  exception_type TEXT,
  tier           TEXT,
  title          TEXT,
  detail         TEXT,
  due_at         TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$

  -- 1) INVOICES: overdue, or about to become overdue. No "upcoming" tier --
  -- an invoice not yet due within a week isn't an exception yet.
  SELECT
    'invoice'::TEXT,
    i.id,
    'invoice_overdue'::TEXT,
    CASE WHEN i.due_date < CURRENT_DATE THEN 'today' ELSE 'this_week' END,
    'Invoice overdue'::TEXT,
    'Invoice ' || i.invoice_number || ' for $' || i.amount || ' due ' || to_char(i.due_date, 'Mon DD, YYYY'),
    i.due_date::TIMESTAMPTZ
  FROM invoices i
  WHERE i.carrier_org_id = my_org_id()
    AND i.status IN ('sent', 'overdue')
    AND i.due_date IS NOT NULL
    AND i.due_date <= CURRENT_DATE + INTERVAL '7 days'

  UNION ALL

  -- 2) ORG DOCUMENTS: carrier's own compliance docs (COI, MC authority, UCR,
  -- etc.) -- these are typically annual filings, so the "upcoming" horizon
  -- is the widest of the doc branches (180 days, per the UCR-style hint).
  -- entity_type is 'organization', NOT 'customer' -- this branch is scoped
  -- to `od.org_id = my_org_id()`, i.e. the CARRIER's own org, never an
  -- actual customer org. Bug found 2026-07-21: it was originally mislabeled
  -- 'customer', which meant these exceptions silently could never match any
  -- customer-entity filter anywhere in the app (there's no page that lists
  -- exceptions for the carrier's own org itself, only the aggregate inbox/
  -- banner, which don't filter by entity_type -- so this only ever broke a
  -- hypothetical future per-entity view, not anything currently built).
  SELECT
    'organization'::TEXT,
    od.org_id,
    CASE WHEN od.expiry_date < CURRENT_DATE THEN 'doc_expired' ELSE 'doc_expiring' END,
    CASE
      WHEN od.expiry_date < CURRENT_DATE THEN 'today'
      WHEN od.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    CASE WHEN od.expiry_date < CURRENT_DATE THEN 'Compliance document expired' ELSE 'Compliance document expiring' END,
    COALESCE(od.label, od.doc_type) || ' expires ' || to_char(od.expiry_date, 'Mon DD, YYYY'),
    od.expiry_date::TIMESTAMPTZ
  FROM org_documents od
  WHERE od.org_id = my_org_id()
    AND od.expiry_date IS NOT NULL
    AND od.expiry_date <= CURRENT_DATE + INTERVAL '180 days'

  UNION ALL

  -- 3) VEHICLE DOCUMENTS: registration/insurance/DOT authority/annual
  -- inspection -- a middle horizon (60 days) between CDL (30) and the
  -- UCR-style org docs (180); these are typically renewed annually but
  -- carriers plan for them further ahead than a driver's own CDL.
  SELECT
    'vehicle'::TEXT,
    vd.vehicle_id,
    CASE WHEN vd.expiry_date < CURRENT_DATE THEN 'doc_expired' ELSE 'doc_expiring' END,
    CASE
      WHEN vd.expiry_date < CURRENT_DATE THEN 'today'
      WHEN vd.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    CASE WHEN vd.expiry_date < CURRENT_DATE THEN 'Vehicle document expired' ELSE 'Vehicle document expiring' END,
    v.nickname || ': ' || COALESCE(vd.label, vd.doc_type) || ' expires ' || to_char(vd.expiry_date, 'Mon DD, YYYY'),
    vd.expiry_date::TIMESTAMPTZ
  FROM vehicle_documents vd
  JOIN vehicles v ON v.id = vd.vehicle_id
  WHERE vd.carrier_org_id = my_org_id()
    AND vd.expiry_date IS NOT NULL
    AND vd.expiry_date <= CURRENT_DATE + INTERVAL '60 days'

  UNION ALL

  -- 4) DRIVER CDL EXPIRY: authoritative structured field (drivers.cdl_expiry),
  -- not driver_documents -- see function-level note above. 30-day horizon
  -- per the CDL-specific hint.
  SELECT
    'driver'::TEXT,
    d.id,
    'cdl_expiring'::TEXT,
    CASE
      WHEN d.cdl_expiry < CURRENT_DATE THEN 'today'
      WHEN d.cdl_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    'CDL expiring'::TEXT,
    trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) || '''s CDL expires ' || to_char(d.cdl_expiry, 'Mon DD, YYYY'),
    d.cdl_expiry::TIMESTAMPTZ
  FROM drivers d
  JOIN profiles p ON p.id = d.profile_id
  WHERE d.carrier_org_id = my_org_id()
    AND d.cdl_expiry IS NOT NULL
    AND d.cdl_expiry <= CURRENT_DATE + INTERVAL '30 days'

  UNION ALL

  -- 5) DRIVER MEDICAL CERT EXPIRY: same authoritative-field reasoning as CDL
  -- above, same 30-day horizon (DOT physicals are typically flagged on a
  -- similarly short runway).
  SELECT
    'driver'::TEXT,
    d.id,
    'med_cert_expiring'::TEXT,
    CASE
      WHEN d.med_cert_expiry < CURRENT_DATE THEN 'today'
      WHEN d.med_cert_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    'Medical certificate expiring'::TEXT,
    trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) || '''s medical certificate expires ' || to_char(d.med_cert_expiry, 'Mon DD, YYYY'),
    d.med_cert_expiry::TIMESTAMPTZ
  FROM drivers d
  JOIN profiles p ON p.id = d.profile_id
  WHERE d.carrier_org_id = my_org_id()
    AND d.med_cert_expiry IS NOT NULL
    AND d.med_cert_expiry <= CURRENT_DATE + INTERVAL '30 days'

  UNION ALL

  -- 6) POD MISSING: a load marked delivered with no matching 'pod'-type
  -- document row. No natural due date to look forward to (delivery already
  -- happened), so tiering instead reflects how overdue the paperwork is: a
  -- 2-day grace period after delivery before this escalates from
  -- 'this_week' to 'today'. due_at is the delivery date (when the POD
  -- should have been captured), falling back to updated_at if delivery_date
  -- was never recorded.
  SELECT
    'load'::TEXT,
    l.id,
    'pod_missing'::TEXT,
    CASE
      WHEN l.delivery_date IS NULL OR l.delivery_date <= CURRENT_DATE - INTERVAL '2 days' THEN 'today'
      ELSE 'this_week'
    END,
    'POD missing'::TEXT,
    'Load ' || l.load_number || ' delivered without a proof of delivery',
    COALESCE(l.delivery_date::TIMESTAMPTZ, l.updated_at)
  FROM loads l
  WHERE l.carrier_org_id = my_org_id()
    AND l.status = 'delivered'
    AND NOT EXISTS (
      SELECT 1 FROM documents doc WHERE doc.load_id = l.id AND doc.type = 'pod'
    )

  UNION ALL

  -- 7) MAINTENANCE DUE: date-based reminders only -- see function-level note
  -- on next_due_miles above. entity_type is 'vehicle' (the reminder is about
  -- the vehicle, not a standalone entity of its own). 30-day horizon, same
  -- reasoning as CDL: maintenance intervals are usually planned on a
  -- similarly short runway, not an annual one.
  SELECT
    'vehicle'::TEXT,
    mr.vehicle_id,
    'maintenance_due'::TEXT,
    CASE
      WHEN mr.next_due_date < CURRENT_DATE THEN 'today'
      WHEN mr.next_due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    'Maintenance due'::TEXT,
    v.nickname || ': ' || mr.reminder_type || ' due ' || to_char(mr.next_due_date, 'Mon DD, YYYY'),
    mr.next_due_date::TIMESTAMPTZ
  FROM maintenance_reminders mr
  JOIN vehicles v ON v.id = mr.vehicle_id
  WHERE mr.carrier_org_id = my_org_id()
    AND mr.is_active = true
    AND mr.next_due_date IS NOT NULL
    AND mr.next_due_date <= CURRENT_DATE + INTERVAL '30 days'

$$;

GRANT EXECUTE ON FUNCTION get_exceptions() TO authenticated;

-- send_expiry_reminders() is the scheduled-job counterpart to get_exceptions():
-- get_exceptions() is per-session/per-org (my_org_id()-scoped, called by a
-- logged-in user); this runs org-agnostically across ALL orgs, because a
-- cron-style job has no caller session to scope from. SECURITY DEFINER so it
-- can read every org's drivers/vehicle_documents/org_documents in one pass.
-- Internal maintenance function only -- never callable by a logged-in user,
-- so EXECUTE is revoked from authenticated/anon and granted only to
-- service_role (matches this schema's service_role-bypasses-RLS convention,
-- SECTION 8 policy comments near line 1172). Invoked today only via manual
-- `SELECT send_expiry_reminders();` or the carrieros-web
-- /api/cron/send-reminders route (service-role client); no scheduler
-- (pg_cron -- not installed on this instance -- or an external cron hitting
-- that route) is wired up yet. That's a deployment-environment decision, not
-- made here.
--
-- Horizons intentionally reuse get_exceptions()'s exact numbers so a
-- "reminder" and the exception-inbox item it corresponds to agree on when
-- something is showing up at all: CDL 30 days, medical cert 30 days,
-- vehicle_documents 60 days, org_documents 180 days (see that function's
-- per-branch comments for why each horizon was chosen).
--
-- Dedup: within 24h, keyed on (entity_type, entity_id, event_type, title).
-- event_type is always 'reminder_sent' here, and entity_id is the
-- driver/vehicle/org id (not the individual document row, same
-- entity_id-means-the-parent-entity convention get_exceptions() uses for
-- vehicle_documents/org_documents) -- so title (which embeds the specific
-- field/doc) is what keeps e.g. a driver's CDL reminder and med-cert
-- reminder, or two different expiring docs on the same vehicle, from
-- colliding into one dedup bucket.
--
-- entity_type for org_documents is 'customer', same stand-in get_exceptions()
-- uses (exception_events.entity_type's CHECK list has no 'organization'
-- value; org_documents.org_id is the caller's own carrier org, but
-- 'customer' is the only CHECK value backed by the organizations table).
CREATE OR REPLACE FUNCTION send_expiry_reminders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INTEGER := 0;
  v_rows  INTEGER;
BEGIN
  -- 1) Driver CDL expiry -- 30-day horizon (matches get_exceptions() #4).
  INSERT INTO exception_events (carrier_org_id, entity_type, entity_id, event_type, severity, title, detail, occurred_at)
  SELECT
    d.carrier_org_id,
    'driver',
    d.id,
    'reminder_sent',
    CASE
      WHEN d.cdl_expiry < CURRENT_DATE THEN 'urgent'
      WHEN d.cdl_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN 'urgent'
      ELSE 'warning'
    END,
    'CDL expiring reminder sent',
    trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) || '''s CDL expires ' || to_char(d.cdl_expiry, 'Mon DD, YYYY'),
    now()
  FROM drivers d
  JOIN profiles p ON p.id = d.profile_id
  WHERE d.cdl_expiry IS NOT NULL
    AND d.cdl_expiry <= CURRENT_DATE + INTERVAL '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM exception_events ee
      WHERE ee.entity_type = 'driver' AND ee.entity_id = d.id AND ee.event_type = 'reminder_sent'
        AND ee.title = 'CDL expiring reminder sent'
        AND ee.created_at >= now() - INTERVAL '24 hours'
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  -- 2) Driver medical cert expiry -- 30-day horizon (matches get_exceptions() #5).
  INSERT INTO exception_events (carrier_org_id, entity_type, entity_id, event_type, severity, title, detail, occurred_at)
  SELECT
    d.carrier_org_id,
    'driver',
    d.id,
    'reminder_sent',
    CASE
      WHEN d.med_cert_expiry < CURRENT_DATE THEN 'urgent'
      WHEN d.med_cert_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN 'urgent'
      ELSE 'warning'
    END,
    'Medical certificate expiring reminder sent',
    trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) || '''s medical certificate expires ' || to_char(d.med_cert_expiry, 'Mon DD, YYYY'),
    now()
  FROM drivers d
  JOIN profiles p ON p.id = d.profile_id
  WHERE d.med_cert_expiry IS NOT NULL
    AND d.med_cert_expiry <= CURRENT_DATE + INTERVAL '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM exception_events ee
      WHERE ee.entity_type = 'driver' AND ee.entity_id = d.id AND ee.event_type = 'reminder_sent'
        AND ee.title = 'Medical certificate expiring reminder sent'
        AND ee.created_at >= now() - INTERVAL '24 hours'
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  -- 3) Vehicle documents -- 60-day horizon (matches get_exceptions() #3).
  INSERT INTO exception_events (carrier_org_id, entity_type, entity_id, event_type, severity, title, detail, occurred_at)
  SELECT
    vd.carrier_org_id,
    'vehicle',
    vd.vehicle_id,
    'reminder_sent',
    CASE
      WHEN vd.expiry_date < CURRENT_DATE THEN 'urgent'
      WHEN vd.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'urgent'
      ELSE 'warning'
    END,
    'Vehicle document expiring: ' || COALESCE(vd.label, vd.doc_type),
    v.nickname || ': ' || COALESCE(vd.label, vd.doc_type) || ' expires ' || to_char(vd.expiry_date, 'Mon DD, YYYY'),
    now()
  FROM vehicle_documents vd
  JOIN vehicles v ON v.id = vd.vehicle_id
  WHERE vd.carrier_org_id IS NOT NULL
    AND vd.expiry_date IS NOT NULL
    AND vd.expiry_date <= CURRENT_DATE + INTERVAL '60 days'
    AND NOT EXISTS (
      SELECT 1 FROM exception_events ee
      WHERE ee.entity_type = 'vehicle' AND ee.entity_id = vd.vehicle_id AND ee.event_type = 'reminder_sent'
        AND ee.title = 'Vehicle document expiring: ' || COALESCE(vd.label, vd.doc_type)
        AND ee.created_at >= now() - INTERVAL '24 hours'
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  -- 4) Org (carrier compliance) documents -- 180-day horizon (matches
  -- get_exceptions() #2). entity_type 'customer' per the note above.
  INSERT INTO exception_events (carrier_org_id, entity_type, entity_id, event_type, severity, title, detail, occurred_at)
  SELECT
    od.org_id,
    'customer',
    od.org_id,
    'reminder_sent',
    CASE
      WHEN od.expiry_date < CURRENT_DATE THEN 'urgent'
      WHEN od.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'urgent'
      ELSE 'warning'
    END,
    'Compliance document expiring: ' || COALESCE(od.label, od.doc_type),
    COALESCE(od.label, od.doc_type) || ' expires ' || to_char(od.expiry_date, 'Mon DD, YYYY'),
    now()
  FROM org_documents od
  WHERE od.org_id IS NOT NULL
    AND od.expiry_date IS NOT NULL
    AND od.expiry_date <= CURRENT_DATE + INTERVAL '180 days'
    AND NOT EXISTS (
      SELECT 1 FROM exception_events ee
      WHERE ee.entity_type = 'customer' AND ee.entity_id = od.org_id AND ee.event_type = 'reminder_sent'
        AND ee.title = 'Compliance document expiring: ' || COALESCE(od.label, od.doc_type)
        AND ee.created_at >= now() - INTERVAL '24 hours'
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION send_expiry_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION send_expiry_reminders() FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION send_expiry_reminders() TO service_role;

-- Customer health score (Growth+, has_feature('customer_health_score')) --
-- live computed 0-100 score, same "computed live, not stored" idiom as
-- get_exceptions()/mark_overdue_invoices() above. Must be defined after
-- my_org_id() for the same fresh-replay ordering reason as every other
-- function in this section.
--
-- Formula: 70% on-time-payment rate + 30% inverse exception-frequency score,
-- both normalized 0-100.
--   - On-time-payment rate: of this customer's PAID invoices that have a
--     due_date, the % paid at or before that due_date. Invoices with a null
--     due_date are excluded from the denominator rather than guessed at (an
--     invoice with no due date was never "late"). A customer with zero paid
--     invoices has no payment signal yet, so this component defaults to 100
--     (benefit of the doubt) rather than 0 (which would unfairly read as
--     "bad payer" for a brand-new relationship).
--   - Exception frequency: count of exception_events for this customer
--     (entity_type='customer') in the last 90 days, as a rough proxy for
--     recent relationship friction. Capped at 10 events -> treated as the
--     floor (score 0); 0 events -> 100. Linear in between
--     (100 - count*10), clamped to [0,100].
-- The two components are then blended 70/30 and rounded to the nearest
-- whole point.
CREATE OR REPLACE FUNCTION get_customer_health_score(customer_org_id BIGINT)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_paid_total   INT;
  v_paid_on_time INT;
  v_payment_pct  NUMERIC;
  v_exception_ct INT;
  v_exception_pct NUMERIC;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE due_date IS NOT NULL),
    COUNT(*) FILTER (WHERE due_date IS NOT NULL AND paid_at IS NOT NULL AND paid_at::DATE <= due_date)
  INTO v_paid_total, v_paid_on_time
  FROM invoices
  WHERE invoices.customer_org_id = get_customer_health_score.customer_org_id
    AND carrier_org_id = my_org_id()
    AND status = 'paid';

  v_payment_pct := CASE WHEN v_paid_total > 0
    THEN (v_paid_on_time::NUMERIC / v_paid_total) * 100
    ELSE 100
  END;

  SELECT COUNT(*)
  INTO v_exception_ct
  FROM exception_events
  WHERE exception_events.entity_type = 'customer'
    AND exception_events.entity_id = get_customer_health_score.customer_org_id
    AND carrier_org_id = my_org_id()
    AND occurred_at >= now() - INTERVAL '90 days';

  v_exception_pct := GREATEST(0, 100 - (LEAST(v_exception_ct, 10) * 10));

  RETURN ROUND((v_payment_pct * 0.7) + (v_exception_pct * 0.3));
END;
$$;
GRANT EXECUTE ON FUNCTION get_customer_health_score(BIGINT) TO authenticated;

-- DRIVERS
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_solo_drivers_all" ON drivers FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);
CREATE POLICY "dispatcher_drivers_select" ON drivers FOR SELECT USING (
  carrier_org_id = my_org_id()
  AND my_role() = 'dispatcher'
);

-- Added 2026-07-20 (audit finding 8): finance could not read drivers at all,
-- so driver names rendered blank on every finance-facing screen.
CREATE POLICY "finance_drivers_select" ON drivers FOR SELECT TO authenticated
  USING (carrier_org_id = my_org_id() AND my_role() = 'finance');
CREATE POLICY "driver_own_record" ON drivers FOR SELECT USING (profile_id = auth.uid());
-- CRITICAL (fixed 2026-07-20): this had WITH CHECK (true), letting a driver
-- rewrite any column on their own row — including carrier_org_id (move
-- themselves between carriers) and cdl_expiry/med_cert_expiry (falsify the
-- very compliance dates this product exists to track).
-- The helper is SECURITY DEFINER because a plain subquery on `drivers` inside
-- a policy ON drivers recurses (same trap that broke `profiles`).
CREATE OR REPLACE FUNCTION driver_self_update_allowed(
  p_org BIGINT, p_cdl_expiry DATE, p_med_expiry DATE, p_active BOOLEAN, p_number TEXT
) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT p_org = d.carrier_org_id
     AND p_cdl_expiry IS NOT DISTINCT FROM d.cdl_expiry
     AND p_med_expiry IS NOT DISTINCT FROM d.med_cert_expiry
     AND p_active     IS NOT DISTINCT FROM d.is_active
     AND p_number     IS NOT DISTINCT FROM d.driver_number
  FROM drivers d WHERE d.profile_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION driver_self_update_allowed(BIGINT,DATE,DATE,BOOLEAN,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver_self_update_allowed(BIGINT,DATE,DATE,BOOLEAN,TEXT) TO authenticated;

-- A driver may edit their own contact details (emergency contact, CDL
-- number/class/state, endorsements, default vehicle) but not the fields
-- defining their employment or compliance standing.
CREATE POLICY "driver_own_record_update" ON drivers FOR UPDATE TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (
    profile_id = auth.uid()
    AND driver_self_update_allowed(carrier_org_id, cdl_expiry, med_cert_expiry, is_active, driver_number)
  );

-- VEHICLES (renamed from TRUCKS, 2026-07-21, decisions.md S8)
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_vehicles_select" ON vehicles FOR SELECT USING (
  carrier_org_id = my_org_id()
);
CREATE POLICY "owner_solo_vehicles_all" ON vehicles FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

-- DOCUMENTS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_docs_select" ON documents FOR SELECT USING (
  carrier_org_id = my_org_id()
  AND (my_role() <> 'driver' OR uploaded_by = auth.uid() OR load_id IN (SELECT id FROM loads WHERE driver_id = my_driver_id()))
);
-- CRITICAL (fixed 2026-07-20): checked only that the row claimed the caller's
-- uid, never the org — any user could plant phantom document rows that render
-- in a FOREIGN carrier's document list, pointing at storage they cannot read.
CREATE POLICY "driver_pod_insert" ON documents FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND carrier_org_id = my_org_id());

-- Added 2026-07-20 (audit finding 7): a driver who uploaded the wrong POD could
-- not remove it — DELETE failed silently as DELETE 0, and LoadDocuments.tsx
-- performs exactly this delete. Scoped to documents the caller uploaded.
CREATE POLICY "uploader_deletes_own_doc" ON documents FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() AND carrier_org_id = my_org_id());
CREATE POLICY "owner_solo_docs_all" ON documents FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

-- LOAD EVENTS
ALTER TABLE load_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_load_events_select" ON load_events FOR SELECT USING (
  load_id IN (SELECT id FROM loads WHERE carrier_org_id = my_org_id())
);
-- CRITICAL (fixed 2026-07-20): same shape as driver_pod_insert above — any
-- authenticated user could inject fake status events into ANY carrier's load
-- timeline, because only the uid was checked, never the org.
CREATE POLICY "authenticated_load_events_insert" ON load_events FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND load_id IN (SELECT id FROM loads WHERE carrier_org_id = my_org_id())
  );

-- DVIR INSPECTIONS
ALTER TABLE dvir_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_dvir_select" ON dvir_inspections FOR SELECT USING (
  carrier_org_id = my_org_id()
);
-- Fixed 2026-09-21 (migration 0029): originally driver_id only -- a driver's own driver_id doesn't
-- vary by which org a submitted row claims, so any driver could INSERT a foreign-org-tagged row.
-- Both this and driver_dvir_modify below now also require carrier_org_id = my_org_id().
CREATE POLICY "driver_dvir_insert" ON dvir_inspections FOR INSERT WITH CHECK (
  driver_id = my_driver_id()
  AND carrier_org_id = my_org_id()
);

-- Added 2026-07-20 (audit finding 6): driver had INSERT only, so a two-step
-- submit (insert inspection, then attach signature/odometer) was impossible —
-- the update failed silently as UPDATE 0.
CREATE POLICY "driver_dvir_modify" ON dvir_inspections FOR UPDATE TO authenticated
  USING (driver_id = my_driver_id() AND carrier_org_id = my_org_id())
  WITH CHECK (driver_id = my_driver_id() AND carrier_org_id = my_org_id());
CREATE POLICY "owner_solo_dvir_all" ON dvir_inspections FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

-- DVIR DEFECTS
ALTER TABLE dvir_defects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dvir_defects_select" ON dvir_defects FOR SELECT USING (
  inspection_id IN (SELECT id FROM dvir_inspections WHERE carrier_org_id = my_org_id())
);
CREATE POLICY "driver_dvir_defects_insert" ON dvir_defects FOR INSERT WITH CHECK (
  inspection_id IN (SELECT id FROM dvir_inspections WHERE driver_id = my_driver_id())
);
-- owner/solo counterpart (added 2026-07-20). The policy above keys on driver_id
-- matching a `drivers` row, but owner/solo accounts have NO drivers row — that
-- table is only for invited employee-drivers. So owner/solo could create an
-- inspection (owner_solo_dvir_all) but never attach a defect to it, and a DVIR
-- with a defect is the whole point. Mirrors owner_solo_dvir_all one level down:
-- keyed on role + org, not driver_id. Solo is the primary MVP persona.
-- Added 2026-07-20 (audit finding 6): a driver had INSERT and nothing else, so
-- correcting or removing a defect failed as a silent 0-row no-op — the UI
-- appeared to accept the edit and discarded it. Scoped to own inspections.
CREATE POLICY "driver_dvir_defects_modify" ON dvir_defects FOR ALL TO authenticated
  USING (inspection_id IN (
    SELECT i.id FROM dvir_inspections i
    WHERE i.driver_id = (SELECT d.id FROM drivers d WHERE d.profile_id = auth.uid())))
  WITH CHECK (inspection_id IN (
    SELECT i.id FROM dvir_inspections i
    WHERE i.driver_id = (SELECT d.id FROM drivers d WHERE d.profile_id = auth.uid())));

CREATE POLICY "owner_solo_dvir_defects_all" ON dvir_defects FOR ALL TO authenticated
  USING (
    my_role() IN ('owner','solo')
    AND inspection_id IN (SELECT id FROM dvir_inspections WHERE carrier_org_id = my_org_id())
  )
  WITH CHECK (
    my_role() IN ('owner','solo')
    AND inspection_id IN (SELECT id FROM dvir_inspections WHERE carrier_org_id = my_org_id())
  );

-- SERVICE LOGS
ALTER TABLE service_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_service_logs_select" ON service_logs FOR SELECT USING (
  carrier_org_id = my_org_id()
);
CREATE POLICY "owner_solo_service_logs_all" ON service_logs FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

-- MAINTENANCE REMINDERS
ALTER TABLE maintenance_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_reminders_select" ON maintenance_reminders FOR SELECT USING (
  carrier_org_id = my_org_id()
);
CREATE POLICY "owner_solo_reminders_all" ON maintenance_reminders FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

-- VEHICLE DOCUMENTS (renamed from TRUCK DOCUMENTS, 2026-07-21, decisions.md S8)
ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_vehicle_docs_select" ON vehicle_documents FOR SELECT USING (
  carrier_org_id = my_org_id()
);
CREATE POLICY "owner_solo_vehicle_docs_all" ON vehicle_documents FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

-- ORG DOCUMENTS
ALTER TABLE org_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_solo_org_docs_all" ON org_documents FOR ALL USING (
  org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);
CREATE POLICY "finance_org_docs_select" ON org_documents FOR SELECT USING (
  org_id = my_org_id()
  AND my_role() = 'finance'
);

-- DRIVER DOCUMENTS (new, 2026-07-21, decisions.md S10 — mirrors
-- vehicle_documents' shape exactly, scoped via a direct profiles subquery)
ALTER TABLE driver_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_driver_docs_select" ON driver_documents FOR SELECT USING (
  carrier_org_id = my_org_id()
  AND (my_role() IN ('owner','solo','dispatcher') OR driver_id = my_driver_id())
);
CREATE POLICY "owner_solo_driver_docs_all" ON driver_documents FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

-- EXCEPTION EVENTS (new, 2026-07-21, decisions.md P2 amendment) — scoped via
-- my_org_id(), a deliberate choice for this new table, not a claim that every
-- older table's policy uses the same shape (older ones use a direct profiles
-- subquery; only newer tables use the helper function).
ALTER TABLE exception_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_exception_events_select" ON exception_events FOR SELECT TO authenticated
  USING (carrier_org_id = my_org_id());
CREATE POLICY "owner_solo_exception_events_all" ON exception_events FOR ALL TO authenticated
  USING (carrier_org_id = my_org_id() AND my_role() IN ('owner','solo'))
  WITH CHECK (carrier_org_id = my_org_id() AND my_role() IN ('owner','solo'));
-- Driver problem/delay reporting (mockup-03 Screen 3's 4th status option,
-- previously unbuilt) -- a driver may only self-report against their OWN
-- assigned load, never on behalf of another driver's load or any other
-- entity_type/event_type (locked to this one shape so this can't become a
-- backdoor for a driver to write arbitrary exception rows).
CREATE POLICY "driver_exception_events_insert" ON exception_events FOR INSERT TO authenticated
  WITH CHECK (
    carrier_org_id = my_org_id()
    AND my_role() = 'driver'
    AND entity_type = 'load'
    AND event_type = 'driver_reported_problem'
    AND entity_id IN (SELECT id FROM loads WHERE driver_id = my_driver_id())
  );

-- PLATFORM ADMIN (SHIPMENTX) TABLES (new, 2026-07-22, Phase 8 foundation) --
-- gated on my_role() alone, no org-membership check needed since only a
-- trusted action ever assigns an sx_* role (see SECTION 3c's comment for why
-- this is safe and why cross-org tenant-table reads do NOT get a matching
-- policy here). admin_events and billing_events get no authenticated INSERT
-- policy at all -- both are written exclusively by service-role admin API
-- routes, so default-deny is correct for direct client writes.
ALTER TABLE admin_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sx_admin_notes_all" ON admin_notes FOR ALL TO authenticated
  USING (my_role() IN ('sx_owner','sx_finance','sx_support'))
  WITH CHECK (my_role() IN ('sx_owner','sx_finance','sx_support'));

ALTER TABLE admin_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sx_admin_events_select" ON admin_events FOR SELECT TO authenticated
  USING (my_role() IN ('sx_owner','sx_finance','sx_support'));

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sx_billing_events_select" ON billing_events FOR SELECT TO authenticated
  USING (my_role() IN ('sx_owner','sx_finance'));

ALTER TABLE platform_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sx_platform_flags_select" ON platform_flags FOR SELECT TO authenticated
  USING (my_role() IN ('sx_owner','sx_finance','sx_support'));
CREATE POLICY "sx_owner_platform_flags_write" ON platform_flags FOR ALL TO authenticated
  USING (my_role() = 'sx_owner') WITH CHECK (my_role() = 'sx_owner');

ALTER TABLE org_flag_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sx_org_flag_overrides_select" ON org_flag_overrides FOR SELECT TO authenticated
  USING (my_role() IN ('sx_owner','sx_finance','sx_support'));
CREATE POLICY "sx_owner_org_flag_overrides_write" ON org_flag_overrides FOR ALL TO authenticated
  USING (my_role() = 'sx_owner') WITH CHECK (my_role() = 'sx_owner');

-- ────────────────────────────────────────────────────────────
-- SECTION 8b: STORAGE (bucket + object-level RLS)
-- ────────────────────────────────────────────────────────────
-- Private bucket for POD photos, BOLs, rate cons, DVIR defect photos.
-- Never public — every read goes through a signed URL.
-- Path convention: {carrier_org_id}/loads/{load_id}/{filename}
--                  {carrier_org_id}/dvir/{inspection_id}/{filename}
-- First path segment is always the carrier org id; every policy keys on it.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documents', 'documents', false, 10485760,
        ARRAY['image/jpeg','image/png','image/heic','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Historical bucket from migration 0039. It is intentionally empty and unused;
-- active profile photos use the canonical documents bucket and org-first paths.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', false, 5242880,
        ARRAY['image/jpeg','image/png','image/webp','image/heic'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "org_docs_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = my_org_id()::text);

CREATE POLICY "org_docs_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = my_org_id()::text);

-- Only owner/solo may overwrite or remove — a driver must not be able to
-- delete a POD after uploading it (audit trail for the carrier).
CREATE POLICY "owner_solo_docs_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = my_org_id()::text
         AND my_role() IN ('owner','solo'));

CREATE POLICY "owner_solo_docs_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = my_org_id()::text
         AND my_role() IN ('owner','solo'));

-- Rollback path for a failed upload: any org member may delete an object ONLY
-- while it is orphaned (no documents row references it). Once the documents
-- row exists the object is filed proof and this policy stops applying, so a
-- driver still cannot delete a real POD. Deliberately a policy, not an RPC —
-- deletes must go through the Storage API so the file bytes are removed, not
-- just the metadata row. storage.protect_delete() blocks a direct
-- DELETE ON storage.objects for exactly that reason.
CREATE POLICY "member_deletes_orphan_docs" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents'
         AND (storage.foldername(name))[1] = my_org_id()::text
         AND NOT EXISTS (
           SELECT 1 FROM public.documents d WHERE d.storage_path = storage.objects.name
         ));

-- ────────────────────────────────────────────────────────────
-- SECTION 8c: BASE TABLE GRANTS
-- ────────────────────────────────────────────────────────────
-- Real bug found and fixed 2026-07-21: RLS policies alone are not enough —
-- Postgres requires the base object privilege (GRANT) before a role even
-- reaches the RLS layer. Every table added this session (vehicle_types,
-- vehicle_classifications, vehicle_type_classifications, roles, languages,
-- tiers, features, driver_documents) had a correct `USING (true)` or
-- org-scoped SELECT policy, but `authenticated` had no base SELECT grant at
-- all — confirmed via `\dp`, which showed `authenticated=Dxtm` (missing
-- a/r/w) instead of the `arwdDxtm` every earlier table has. The query didn't
-- error, it silently returned zero rows, which is exactly the kind of thing
-- that looks like an empty state rather than a bug. This one blanket
-- statement makes a fresh `schema.sql` replay/`db reset` self-sufficient,
-- replacing the previously undocumented "manually run GRANT statements"
-- step (`README.md` referenced grants "noted at the top of it" that, as of
-- this fix, do not actually exist anywhere in the file or the repo — pure
-- tribal knowledge until now).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- Narrowing pass (migration 0002_tighten_base_grants.sql, 2026-07-26). The
-- blanket grant above is deliberately kept — it solves the "correct policy,
-- missing grant, silent zero rows" bug described above — but it is then walked
-- back for the objects that never needed write access. Leaving `authenticated`
-- with DELETE on the reference catalogs meant RLS was the only thing standing
-- between a session and `DELETE FROM tiers`; grants and RLS should fail
-- independently, not in series.
--
-- Kept in sync with 0002 by scripts/db/verify-migrations.mjs, which builds a
-- database from migrations and diffs its grants against a replay of this file.
REVOKE INSERT, UPDATE, DELETE ON tiers, features, languages, ifta_tax_rates, roles,
  vehicle_types, vehicle_classifications, vehicle_type_classifications, platform_flags,
  role_capabilities
  FROM authenticated;
GRANT SELECT ON tiers, features, languages, ifta_tax_rates, roles,
  vehicle_types, vehicle_classifications, vehicle_type_classifications, platform_flags,
  role_capabilities
  TO authenticated;

-- TRUNCATE is not subject to row-level security — a policy limiting DELETE to
-- your own org does nothing against it. `anon` held it on all 40 tables via the
-- blanket grant above (migration 0003, 2026-07-26). Unreachable through
-- PostgREST, which exposes no TRUNCATE verb, but there is no reason for either
-- role to hold it.
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon', t.relname);
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM authenticated', t.relname);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- SECTION 9: TRIGGERS
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER loads_updated_at
  BEFORE UPDATE ON loads FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER org_docs_updated_at
  BEFORE UPDATE ON org_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────
-- DONE — v4.0
-- After running: supabase gen types typescript --local > carrieros-web/types/supabase.ts
-- Seed: INSERT INTO organizations(type,name) + carrier_details row, then UPDATE profiles
-- ────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────
-- SECTION 10: COMMAND INFRASTRUCTURE (migration 0005, 2026-07-26)
-- Transactional outbox, idempotency-key storage, append-only audit trail.
-- Additive: nothing in the existing app reads or writes these yet. Placed
-- AFTER SECTION 8c's blanket grant on purpose so these tables are governed
-- only by the explicit grants below, not swept up by it.
-- ────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- OUTBOX
-- ────────────────────────────────────────────────────────────────────────────
-- Why an outbox rather than emitting events directly: an aggregate write and
-- its event must both happen or neither. Publishing after commit loses events
-- when the process dies in between; publishing before commit emits events for
-- changes that then roll back. Writing the event into the SAME transaction as
-- the aggregate makes the pair atomic, and a separate worker relays it.
--
-- Supabase Realtime is explicitly NOT this mechanism. Realtime is a
-- best-effort notification to connected clients — no delivery guarantee, no
-- retry, no ordering, nothing for a client that was offline. It is fine for
-- "something changed, re-fetch", and that is all it is used for.
CREATE TABLE outbox_events (
  id               BIGSERIAL PRIMARY KEY,

  -- Business fact, past tense (MilestoneSubmitted, InvoiceDisputed, ...).
  event_type       TEXT NOT NULL,
  aggregate_type   TEXT NOT NULL,
  aggregate_id     TEXT NOT NULL,

  -- Tenant that owns the fact. Consumers must never process an event without
  -- re-establishing this scope; it is carried here so a relay never has to
  -- guess it from the payload.
  org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  payload          JSONB NOT NULL,

  -- Ties the event back to the HTTP request that produced it, through logs,
  -- audit rows and any downstream effect. The single most useful field during
  -- an incident.
  correlation_id   TEXT NOT NULL,

  -- Stable business key for the action that produced this event. UNIQUE, so a
  -- retried command cannot enqueue the same fact twice — this is what makes
  -- "replaying must not create duplicate business effects" enforceable at the
  -- database rather than hoped for in application code.
  idempotency_key  TEXT NOT NULL UNIQUE,

  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','processed','failed','dead_lettered')),

  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 8,
  -- Exponential backoff with jitter is computed by the worker and written here;
  -- the worker claims rows where next_attempt_at <= now().
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error       TEXT,

  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at     TIMESTAMPTZ,

  -- Set when an operator replays a dead-lettered event, so a replay is
  -- distinguishable from an original delivery in the audit trail.
  replayed_from_id BIGINT REFERENCES outbox_events(id),
  replayed_by      UUID REFERENCES auth.users(id)
);

-- The worker's claim query: oldest-ready-first within status.
CREATE INDEX idx_outbox_claimable
  ON outbox_events (status, next_attempt_at, id)
  WHERE status IN ('pending', 'failed');

-- Per-aggregate ordering and debugging ("what happened to this load?").
CREATE INDEX idx_outbox_aggregate ON outbox_events (aggregate_type, aggregate_id, id);
CREATE INDEX idx_outbox_correlation ON outbox_events (correlation_id);
CREATE INDEX idx_outbox_org ON outbox_events (org_id, occurred_at DESC);

COMMENT ON TABLE outbox_events IS
  'Transactional outbox. Written in the same transaction as the aggregate change it describes; relayed by a worker. Not client-readable.';

-- Infrastructure, not tenant data. No policy is defined, so RLS denies every
-- non-superuser read: the relay worker connects with elevated credentials and
-- is the only legitimate reader. Enabled anyway (rather than left off) so that
-- a future blanket GRANT cannot turn it into a readable table.
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON outbox_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE outbox_events_id_seq FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCY KEYS
-- ────────────────────────────────────────────────────────────────────────────
-- Mobile retries on flaky connections; a user double-taps; a proxy replays.
-- Without this, "submit invoice" twice creates two invoices.
--
-- request_hash is what makes reuse detectable: the same key with the same body
-- replays the stored response, the same key with a DIFFERENT body is an error
-- rather than a silent overwrite of an unrelated command's result.
CREATE TABLE idempotency_keys (
  id             BIGSERIAL PRIMARY KEY,
  org_id         BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  idempotency_key TEXT NOT NULL,
  -- Scoping the uniqueness to the endpoint prevents one client's key from
  -- colliding with another endpoint's key of the same value.
  endpoint       TEXT NOT NULL,
  request_hash   TEXT NOT NULL,

  status_code    INTEGER NOT NULL,
  response_body  JSONB,

  correlation_id TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Retention: keys are only useful for as long as a client might retry.
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',

  UNIQUE (org_id, endpoint, idempotency_key)
);

CREATE INDEX idx_idempotency_expiry ON idempotency_keys (expires_at);

COMMENT ON TABLE idempotency_keys IS
  'Stored responses for Idempotency-Key replay. Written only by the API layer.';

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
-- Read-your-own-org only, and no client writes: the API writes these using the
-- caller's session, so a policy is required for the insert to succeed, but the
-- key material is never useful to a client directly.
CREATE POLICY "idempotency_same_org" ON idempotency_keys
  FOR ALL TO authenticated
  USING (org_id = my_org_id())
  WITH CHECK (org_id = my_org_id() AND user_id = auth.uid());
GRANT SELECT, INSERT ON idempotency_keys TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE idempotency_keys_id_seq TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- AUDIT EVENTS
-- ────────────────────────────────────────────────────────────────────────────
-- Append-only. Every domain state transition and every privileged operation
-- writes one row: prior state, new state, reason, actor, scope, effective time,
-- correlation id, expected version.
--
-- The existing `admin_events` table covers SuperAdmin actions only. This is the
-- tenant-facing equivalent, and is what makes "who moved this load to
-- delivered, and when, and why" answerable — today `load_events` records the
-- what but not the actor's intent, and nothing ties it to a request.
CREATE TABLE audit_events (
  id               BIGSERIAL PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  action           TEXT NOT NULL,
  aggregate_type   TEXT NOT NULL,
  aggregate_id     TEXT NOT NULL,

  prior_state      TEXT,
  new_state        TEXT,
  reason           TEXT,

  -- The version the actor believed they were changing. Retained even on
  -- success so a conflict investigation can reconstruct interleaving.
  expected_version INTEGER,

  correlation_id   TEXT NOT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata         JSONB
);

CREATE INDEX idx_audit_org_time ON audit_events (org_id, occurred_at DESC);
CREATE INDEX idx_audit_aggregate ON audit_events (aggregate_type, aggregate_id, occurred_at DESC);
CREATE INDEX idx_audit_correlation ON audit_events (correlation_id);
CREATE INDEX idx_audit_actor ON audit_events (actor_user_id, occurred_at DESC);

COMMENT ON TABLE audit_events IS
  'Append-only tenant audit trail. No UPDATE or DELETE grant is issued to any application role.';

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Readable within your own org. Deliberately NOT readable by drivers: an audit
-- trail exposes who did what across the whole tenant, which is management
-- information rather than operational data.
CREATE POLICY "audit_read_own_org" ON audit_events
  FOR SELECT TO authenticated
  USING (org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher','finance'));

-- Inserts come from the API acting as the caller. No UPDATE/DELETE policy
-- exists at all, which is what makes the table append-only in practice: even a
-- compromised session cannot rewrite history through PostgREST.
CREATE POLICY "audit_insert_own_org" ON audit_events
  FOR INSERT TO authenticated
  WITH CHECK (org_id = my_org_id());

GRANT SELECT, INSERT ON audit_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE audit_events_id_seq TO authenticated;
-- Explicit: no UPDATE, no DELETE, for anyone.
REVOKE UPDATE, DELETE ON audit_events FROM authenticated, anon;

-- migration 0008, 2026-08-18: neither table above ever granted service_role
-- anything. GRANT and RLS are orthogonal — service_role bypasses RLS but
-- still needs an explicit grant to touch a table at all. Without this, no
-- backend worker or admin tool running as service_role could read the
-- outbox to publish events, or read the audit log. UPDATE on outbox_events
-- (not INSERT) so a worker can mark rows processed/failed; inserts stay
-- exclusive to the SECURITY DEFINER command functions below.
GRANT SELECT, UPDATE ON outbox_events TO service_role;
GRANT SELECT ON audit_events TO service_role;

-- ────────────────────────────────────────────────────────────
-- SECTION 11: COMMAND FUNCTIONS (migration 0006, 2026-07-26)
-- Atomic multi-write commands for the /api/v1 path. PostgREST cannot span
-- statements in one transaction, so a command that must update an aggregate
-- AND write its outbox/audit rows indivisibly has to live here. These
-- functions validate preconditions and persist; they make no business
-- decision -- that stays in server/domain + server/application.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION submit_shipment_milestone(
  p_load_id          BIGINT,
  p_expected_status  TEXT,   -- compare-and-swap precondition
  p_new_status       TEXT,
  p_event_type       TEXT,
  p_reason           TEXT,
  p_correlation_id   TEXT,
  p_idempotency_key  TEXT,
  p_occurred_at      TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     BIGINT;
  v_actor      UUID;
  v_updated    INTEGER;
  v_load       RECORD;
  v_existing   BIGINT;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  -- Idempotency first. A retried command (mobile on a flaky connection, a
  -- double-tap, a proxy replay) must not produce a second timeline entry or a
  -- second outbox event. outbox_events.idempotency_key is UNIQUE, so this is
  -- belt-and-braces with the constraint rather than a substitute for it.
  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, status, load_number INTO v_load FROM loads WHERE id = p_load_id;
    RETURN jsonb_build_object(
      'outcome',   'REPLAYED',
      'load_id',   p_load_id,
      'status',    v_load.status,
      'load_number', v_load.load_number
    );
  END IF;

  -- Compare-and-swap on the current status. `loads` has no version column and
  -- adding one to a hot table for this is disproportionate: for a state
  -- machine the current state IS the version, and "move from X to Y only if
  -- still at X" is exactly the optimistic check that matters. Two dispatchers
  -- advancing the same load concurrently — the real race — is caught here,
  -- because the second one's expected status no longer matches.
  --
  -- carrier_org_id is matched against my_org_id(), NOT against anything the
  -- caller supplied. This is the tenant boundary.
  UPDATE loads
     SET status = p_new_status
   WHERE id = p_load_id
     AND carrier_org_id = v_org_id
     AND status = p_expected_status;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    -- Distinguish the three ways this legitimately fails, so the API can map
    -- them to different HTTP responses instead of one opaque error.
    SELECT id, status, carrier_org_id INTO v_load FROM loads WHERE id = p_load_id;
    IF NOT FOUND OR v_load.carrier_org_id <> v_org_id THEN
      -- Not found and not-yours are answered identically on purpose: telling a
      -- caller that a load exists but belongs to someone else is itself a
      -- cross-tenant disclosure.
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';  -- 0011: PostgREST -> HTTP 404
    END IF;
    RAISE EXCEPTION 'VERSION_CONFLICT:%', v_load.status USING ERRCODE = 'PT409';  -- 0011: 40001 hangs PostgREST; PT409 -> HTTP 409
  END IF;

  SELECT id, status, load_number, driver_id INTO v_load FROM loads WHERE id = p_load_id;

  -- Timeline event. Same table and same event_type spelling the existing code
  -- writes, so migrated and unmigrated loads render identically in the UI.
  INSERT INTO load_events (load_id, event_type, note, created_by)
  VALUES (p_load_id, p_event_type, p_reason, v_actor);

  -- Outbox. Committing with the update above is the entire point of this
  -- function.
  INSERT INTO outbox_events (
    event_type, aggregate_type, aggregate_id, org_id,
    payload, correlation_id, idempotency_key
  ) VALUES (
    'MilestoneSubmitted', 'Shipment', p_load_id::TEXT, v_org_id,
    jsonb_build_object(
      'loadId',      p_load_id,
      'loadNumber',  v_load.load_number,
      'priorStatus', p_expected_status,
      'newStatus',   p_new_status,
      'driverId',    v_load.driver_id,
      'occurredAt',  p_occurred_at
    ),
    p_correlation_id, p_idempotency_key
  );

  -- Audit: prior state, new state, reason, actor, scope, time, correlation.
  INSERT INTO audit_events (
    org_id, actor_user_id, action, aggregate_type, aggregate_id,
    prior_state, new_state, reason, correlation_id, occurred_at
  ) VALUES (
    v_org_id, v_actor, 'shipment.milestone.submitted', 'Shipment', p_load_id::TEXT,
    p_expected_status, p_new_status, p_reason, p_correlation_id, p_occurred_at
  );

  RETURN jsonb_build_object(
    'outcome',     'APPLIED',
    'load_id',     p_load_id,
    'status',      v_load.status,
    'load_number', v_load.load_number
  );
END $$;

COMMENT ON FUNCTION submit_shipment_milestone IS
  'Atomic milestone command: CAS status update + load_events + outbox + audit. Called only by the /api/v1 application service, which owns the transition rules.';

-- Explicit grant. Not left to default PUBLIC — that is exactly the defect
-- migration 0003 closed for two other SECURITY DEFINER functions.
REVOKE EXECUTE ON FUNCTION submit_shipment_milestone(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_shipment_milestone(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- SECTION 12: CHANGE FEED (migration 0012)
-- ────────────────────────────────────────────────────────────
CREATE TABLE change_events (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT NOT NULL,
  entity     TEXT NOT NULL,   -- 'loads' | 'exceptions' | 'invoices' | 'messages' | 'documents'
  entity_id  BIGINT,
  op         TEXT NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_change_events_org_cursor ON change_events (org_id, id);
CREATE INDEX idx_change_events_created ON change_events (created_at);

COMMENT ON TABLE change_events IS
  'Signal-only change feed for the live-update SSE stream. No business data; clients refetch through the API. Deny-all to client roles; short retention (pruned by the API).';

ALTER TABLE change_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON change_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE change_events_id_seq FROM anon, authenticated;
GRANT SELECT, DELETE ON change_events TO service_role;

-- Trigger function. SECURITY DEFINER because the writing user (an authenticated
-- driver, say) has no privilege on change_events by design; search_path is
-- pinned. TG_ARGV[0] = entity name, TG_ARGV[1] = the column holding the org id.
CREATE OR REPLACE FUNCTION emit_change_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row JSONB := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_org BIGINT := NULLIF(v_row ->> TG_ARGV[1], '')::BIGINT;
BEGIN
  IF v_org IS NOT NULL THEN
    INSERT INTO change_events (org_id, entity, entity_id, op)
    VALUES (v_org, TG_ARGV[0], NULLIF(v_row ->> 'id', '')::BIGINT, TG_OP);
  END IF;
  RETURN NULL;
END $$;

-- load_events has no org column; its org is the parent load's. A timeline entry
-- is a change to the load as far as any screen is concerned.
CREATE OR REPLACE FUNCTION emit_change_event_via_load() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_load_id BIGINT := CASE WHEN TG_OP = 'DELETE' THEN OLD.load_id ELSE NEW.load_id END;
  v_org BIGINT;
BEGIN
  SELECT carrier_org_id INTO v_org FROM loads WHERE id = v_load_id;
  IF v_org IS NOT NULL THEN
    INSERT INTO change_events (org_id, entity, entity_id, op) VALUES (v_org, 'loads', v_load_id, TG_OP);
  END IF;
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION emit_change_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION emit_change_event_via_load() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER loads_change_event AFTER INSERT OR UPDATE OR DELETE ON loads
  FOR EACH ROW EXECUTE FUNCTION emit_change_event('loads', 'carrier_org_id');
CREATE TRIGGER load_events_change_event AFTER INSERT OR UPDATE OR DELETE ON load_events
  FOR EACH ROW EXECUTE FUNCTION emit_change_event_via_load();
CREATE TRIGGER exception_events_change_event AFTER INSERT OR UPDATE OR DELETE ON exception_events
  FOR EACH ROW EXECUTE FUNCTION emit_change_event('exceptions', 'carrier_org_id');
CREATE TRIGGER invoices_change_event AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION emit_change_event('invoices', 'carrier_org_id');
CREATE TRIGGER driver_messages_change_event AFTER INSERT OR UPDATE OR DELETE ON driver_messages
  FOR EACH ROW EXECUTE FUNCTION emit_change_event('messages', 'carrier_org_id');
CREATE TRIGGER documents_change_event AFTER INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION emit_change_event('documents', 'carrier_org_id');

-- ────────────────────────────────────────────────────────────
-- SECTION 13: IDEMPOTENCY LIFECYCLE GRANTS + TRUNCATE SWEEP (migration 0013)
-- ────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO service_role;
GRANT USAGE, SELECT ON SEQUENCE idempotency_keys_id_seq TO service_role;

-- (2) TRUNCATE is not subject to row-level security. 0003 revoked it from anon and
-- authenticated on every table that existed then, but default privileges hand it out
-- again to each table created afterwards -- so outbox_events, idempotency_keys,
-- audit_events (append-only by design) and change_events all carried it. PostgREST
-- exposes no TRUNCATE verb, so this was not reachable through the API, but there is no
-- reason for either role to hold it, and a privilege that is merely unreachable today
-- is one refactor away from reachable. Re-run the same sweep, and
-- verify-migrations.mjs now fails if any public table has it granted to a client role.
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon', t.relname);
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM authenticated', t.relname);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- SECTION 14: ATOMIC MARK-INVOICE-PAID (migration 0014, extended by 0033 --
-- see SECTION 26 for the rest of 0033's functions)
-- ────────────────────────────────────────────────────────────
-- 0033 upgraded this from SECURITY INVOKER (2 args) to SECURITY DEFINER (4
-- args, +correlation_id/+idempotency_key) so it could also write an
-- InvoicePaid outbox event -- outbox_events is deny-all to `authenticated`
-- (SECTION 5), so a DEFINER function is the only way to write it from here.
-- Because DEFINER bypasses RLS, the tenant + role check billing_invoices_all
-- used to provide is re-stated explicitly by hand.
CREATE FUNCTION mark_invoice_paid(
  p_invoice_id      BIGINT,
  p_paid_at         TIMESTAMPTZ,
  p_correlation_id  TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   BIGINT;
  v_actor    UUID;
  v_load_id  BIGINT;
  v_amount   NUMERIC;
  v_exists   BOOLEAN;
  v_existing BIGINT;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF my_role() NOT IN ('owner','solo','finance') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'invoice_id', p_invoice_id);
  END IF;

  UPDATE invoices
     SET status = 'paid', paid_at = p_paid_at
   WHERE id = p_invoice_id AND carrier_org_id = v_org_id AND status <> 'paid'
  RETURNING load_id, amount INTO v_load_id, v_amount;

  IF NOT FOUND THEN
    SELECT EXISTS (SELECT 1 FROM invoices WHERE id = p_invoice_id AND carrier_org_id = v_org_id) INTO v_exists;
    IF NOT v_exists THEN
      -- Missing and not-visible-to-you are the same answer on purpose.
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
    END IF;
    RETURN jsonb_build_object('outcome', 'ALREADY_PAID', 'invoice_id', p_invoice_id);
  END IF;

  IF v_load_id IS NOT NULL THEN
    UPDATE loads SET status = 'paid' WHERE id = v_load_id AND carrier_org_id = v_org_id;
  END IF;

  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES (
    'InvoicePaid', 'Invoice', p_invoice_id::TEXT, v_org_id,
    jsonb_build_object('invoiceId', p_invoice_id, 'loadId', v_load_id, 'amount', v_amount, 'paidAt', p_paid_at),
    p_correlation_id, p_idempotency_key
  );

  RETURN jsonb_build_object('outcome', 'APPLIED', 'invoice_id', p_invoice_id, 'load_id', v_load_id);
END $$;

REVOKE EXECUTE ON FUNCTION mark_invoice_paid(BIGINT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_invoice_paid(BIGINT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- SECTION 15: ATOMIC LOG-VEHICLE-SERVICE (migration 0015)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_vehicle_service(
  p_vehicle_id      BIGINT,
  p_service_type    TEXT,
  p_service_date    DATE,
  p_odometer        INTEGER,
  p_cost            NUMERIC,
  p_shop_name       TEXT,
  p_notes           TEXT,
  p_reminder_id     BIGINT,
  p_next_due_date   DATE,
  p_next_due_miles  INTEGER
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org BIGINT := my_org_id();
  v_log_id BIGINT;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_vehicle_id AND carrier_org_id = v_org) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
  END IF;

  INSERT INTO service_logs (vehicle_id, carrier_org_id, service_type, service_date, odometer, cost, shop_name, notes, logged_by)
  VALUES (p_vehicle_id, v_org, p_service_type, p_service_date, p_odometer, p_cost, p_shop_name, p_notes, auth.uid())
  RETURNING id INTO v_log_id;

  IF p_reminder_id IS NOT NULL THEN
    UPDATE maintenance_reminders
       SET last_service_date = p_service_date,
           last_odometer     = p_odometer,
           next_due_date     = p_next_due_date,
           next_due_miles    = p_next_due_miles
     WHERE id = p_reminder_id AND vehicle_id = p_vehicle_id AND carrier_org_id = v_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';  -- rolls the log insert back too
    END IF;
  END IF;

  RETURN v_log_id;
END $$;

REVOKE EXECUTE ON FUNCTION log_vehicle_service(BIGINT, TEXT, DATE, INTEGER, NUMERIC, TEXT, TEXT, BIGINT, DATE, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION log_vehicle_service(BIGINT, TEXT, DATE, INTEGER, NUMERIC, TEXT, TEXT, BIGINT, DATE, INTEGER) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- SECTION 16: REPLACE IFTA CROSSINGS WITH MANUAL (migration 0016)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION replace_ifta_crossings_with_manual(
  p_load_id BIGINT,
  p_rows    JSONB          -- [{ "state": "NV", "miles": 120 }, ...]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org     BIGINT := my_org_id();
  v_vehicle BIGINT;
  v_driver  BIGINT;
  v_count   INTEGER;
BEGIN
  IF v_org IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  SELECT vehicle_id, driver_id INTO v_vehicle, v_driver
    FROM loads WHERE id = p_load_id AND carrier_org_id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
  END IF;

  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: rows must be a non-empty array' USING ERRCODE = 'PT400';
  END IF;

  DELETE FROM ifta_state_crossings WHERE load_id = p_load_id AND carrier_org_id = v_org AND source = 'gps';

  INSERT INTO ifta_state_crossings (carrier_org_id, vehicle_id, driver_id, load_id, state, odometer_est, crossed_at, source)
  SELECT v_org, v_vehicle, v_driver, p_load_id, upper(r.state), r.miles, now(), 'manual'
    FROM jsonb_to_recordset(p_rows) AS r(state TEXT, miles INTEGER)
   WHERE r.state ~ '^[A-Za-z]{2}$' AND r.miles IS NOT NULL AND r.miles > 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'VALIDATION: no valid rows' USING ERRCODE = 'PT400';  -- rolls the delete back too
  END IF;
  RETURN v_count;
END $$;

REVOKE EXECUTE ON FUNCTION replace_ifta_crossings_with_manual(BIGINT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION replace_ifta_crossings_with_manual(BIGINT, JSONB) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- SECTION 17: ATOMIC DVIR SUBMISSION (migration 0017)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION submit_dvir_inspection(
  p_load_id    BIGINT,
  p_vehicle_id BIGINT,
  p_driver_id  BIGINT,
  p_type       TEXT,
  p_condition  TEXT,
  p_odometer   INTEGER,
  p_defects    JSONB          -- [{ "area": "brakes", "description": "...", "severity": "major" }, ...] (may be empty)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org BIGINT := my_org_id();
  v_id  BIGINT;
  v_defects JSONB;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM loads WHERE id = p_load_id AND carrier_org_id = v_org) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
  END IF;

  INSERT INTO dvir_inspections (carrier_org_id, vehicle_id, load_id, driver_id, type, condition, odometer)
  VALUES (v_org, p_vehicle_id, p_load_id, p_driver_id, p_type, p_condition, p_odometer)
  RETURNING id INTO v_id;

  WITH ins AS (
    INSERT INTO dvir_defects (inspection_id, area, description, severity)
    SELECT v_id, d.area, d.description, d.severity
      FROM jsonb_to_recordset(COALESCE(p_defects, '[]'::jsonb)) AS d(area TEXT, description TEXT, severity TEXT)
    RETURNING id, area
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'area', area)), '[]'::jsonb) INTO v_defects FROM ins;

  RETURN jsonb_build_object('id', v_id, 'defects', v_defects);
END $$;

REVOKE EXECUTE ON FUNCTION submit_dvir_inspection(BIGINT, BIGINT, BIGINT, TEXT, TEXT, INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_dvir_inspection(BIGINT, BIGINT, BIGINT, TEXT, TEXT, INTEGER, JSONB) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- SECTION 18: DRIVER LOAD COLUMN GUARD (migration 0018)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_driver_load_columns() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ignored TEXT[] := ARRAY['status', 'last_location_lat', 'last_location_lng', 'last_location_at', 'updated_at'];
BEGIN
  IF my_role() = 'driver' AND (to_jsonb(NEW) - v_ignored) IS DISTINCT FROM (to_jsonb(OLD) - v_ignored) THEN
    RAISE EXCEPTION 'drivers may only change a load''s status and location' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER loads_driver_columns BEFORE UPDATE ON loads
  FOR EACH ROW EXECUTE FUNCTION enforce_driver_load_columns();

-- ────────────────────────────────────────────────────────────
-- SECTION 19: CLOSE PRIVILEGE-ESCALATION PATHS (migration 0019)
-- Policy removals above (profiles/organizations/carrier_details inserts, carrier_details update) live next to
-- their tables. CREATE OR REPLACE below supersedes the earlier submit_shipment_milestone /
-- replace_ifta_crossings_with_manual / check_ifta_completeness definitions.
-- ────────────────────────────────────────────────────────────
-- 3. carrier_details is read-only to clients. Subscription state is written only by the server (admin
--    routes now, the billing provider's webhook later). The policy is dropped as well as the privilege so a
--    future blanket GRANT cannot silently re-open it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON carrier_details FROM anon, authenticated;

-- 4. Who may act on a load, decided once in the database for every SECURITY DEFINER command.
--    Mirrors authorizeLoadAction: owner/solo/dispatcher act on their org's loads, a driver only on a load
--    assigned to them. Everyone else (finance, portal, sx_*) is refused. Not-yours and missing look alike.
CREATE OR REPLACE FUNCTION caller_may_act_on_load(p_load_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE my_role()
    WHEN 'driver' THEN EXISTS (
      SELECT 1 FROM loads l JOIN drivers d ON d.id = l.driver_id
       WHERE l.id = p_load_id AND l.carrier_org_id = my_org_id() AND d.profile_id = auth.uid())
    WHEN 'owner' THEN EXISTS (SELECT 1 FROM loads WHERE id = p_load_id AND carrier_org_id = my_org_id())
    WHEN 'solo' THEN EXISTS (SELECT 1 FROM loads WHERE id = p_load_id AND carrier_org_id = my_org_id())
    WHEN 'dispatcher' THEN EXISTS (SELECT 1 FROM loads WHERE id = p_load_id AND carrier_org_id = my_org_id())
    ELSE FALSE
  END;
$$;
REVOKE EXECUTE ON FUNCTION caller_may_act_on_load(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION caller_may_act_on_load(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION submit_shipment_milestone(
  p_load_id          BIGINT,
  p_expected_status  TEXT,
  p_new_status       TEXT,
  p_event_type       TEXT,
  p_reason           TEXT,
  p_correlation_id   TEXT,
  p_idempotency_key  TEXT,
  p_occurred_at      TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     BIGINT;
  v_actor      UUID;
  v_updated    INTEGER;
  v_load       RECORD;
  v_existing   BIGINT;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  IF NOT caller_may_act_on_load(p_load_id) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, status, load_number INTO v_load FROM loads WHERE id = p_load_id;
    RETURN jsonb_build_object(
      'outcome',     'REPLAYED',
      'load_id',     p_load_id,
      'status',      v_load.status,
      'load_number', v_load.load_number
    );
  END IF;

  UPDATE loads
     SET status = p_new_status
   WHERE id = p_load_id
     AND carrier_org_id = v_org_id
     AND status = p_expected_status;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    SELECT id, status, carrier_org_id INTO v_load FROM loads WHERE id = p_load_id;
    IF NOT FOUND OR v_load.carrier_org_id <> v_org_id THEN
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
    END IF;
    RAISE EXCEPTION 'VERSION_CONFLICT:%', v_load.status USING ERRCODE = 'PT409';
  END IF;

  SELECT id, status, load_number, driver_id INTO v_load FROM loads WHERE id = p_load_id;

  INSERT INTO load_events (load_id, event_type, note, created_by)
  VALUES (p_load_id, p_event_type, p_reason, v_actor);

  INSERT INTO outbox_events (
    event_type, aggregate_type, aggregate_id, org_id,
    payload, correlation_id, idempotency_key
  ) VALUES (
    'MilestoneSubmitted', 'Shipment', p_load_id::TEXT, v_org_id,
    jsonb_build_object(
      'loadId',      p_load_id,
      'loadNumber',  v_load.load_number,
      'priorStatus', p_expected_status,
      'newStatus',   p_new_status,
      'driverId',    v_load.driver_id,
      'occurredAt',  p_occurred_at
    ),
    p_correlation_id, p_idempotency_key
  );

  INSERT INTO audit_events (
    org_id, actor_user_id, action, aggregate_type, aggregate_id,
    prior_state, new_state, reason, correlation_id, occurred_at
  ) VALUES (
    v_org_id, v_actor, 'shipment.milestone.submitted', 'Shipment', p_load_id::TEXT,
    p_expected_status, p_new_status, p_reason, p_correlation_id, p_occurred_at
  );

  RETURN jsonb_build_object(
    'outcome',     'APPLIED',
    'load_id',     p_load_id,
    'status',      v_load.status,
    'load_number', v_load.load_number
  );
END $$;

CREATE OR REPLACE FUNCTION replace_ifta_crossings_with_manual(
  p_load_id BIGINT,
  p_rows    JSONB          -- [{ "state": "NV", "miles": 120 }, ...]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org     BIGINT := my_org_id();
  v_vehicle BIGINT;
  v_driver  BIGINT;
  v_count   INTEGER;
BEGIN
  IF v_org IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  IF NOT caller_may_act_on_load(p_load_id) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
  END IF;

  SELECT vehicle_id, driver_id INTO v_vehicle, v_driver
    FROM loads WHERE id = p_load_id AND carrier_org_id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
  END IF;

  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: rows must be a non-empty array' USING ERRCODE = 'PT400';
  END IF;

  DELETE FROM ifta_state_crossings WHERE load_id = p_load_id AND carrier_org_id = v_org AND source = 'gps';

  INSERT INTO ifta_state_crossings (carrier_org_id, vehicle_id, driver_id, load_id, state, odometer_est, crossed_at, source)
  SELECT v_org, v_vehicle, v_driver, p_load_id, upper(r.state), r.miles, now(), 'manual'
    FROM jsonb_to_recordset(p_rows) AS r(state TEXT, miles INTEGER)
   WHERE r.state ~ '^[A-Za-z]{2}$' AND r.miles IS NOT NULL AND r.miles > 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'VALIDATION: no valid rows' USING ERRCODE = 'PT400';  -- rolls the delete back too
  END IF;
  RETURN v_count;
END $$;

-- 6. No anon access, and no cross-tenant answers: a foreign or missing load both read as "no data".
CREATE OR REPLACE FUNCTION check_ifta_completeness(p_load_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT SUM(odometer_est) FROM ifta_state_crossings WHERE load_id = p_load_id AND carrier_org_id = my_org_id()), 0
  ) >= 0.6 * COALESCE((SELECT total_miles FROM loads WHERE id = p_load_id AND carrier_org_id = my_org_id()), 0);
$$;
REVOKE EXECUTE ON FUNCTION check_ifta_completeness(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION check_ifta_completeness(BIGINT) TO authenticated;

-- 7. Tenant guards on foreign keys that RLS cannot express (RLS checks the row being written, not what
--    its ids point at). Applies to every caller including service_role: the data must be consistent.
CREATE OR REPLACE FUNCTION enforce_load_reference_tenancy() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.driver_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.driver_id IS DISTINCT FROM OLD.driver_id)
     AND NOT EXISTS (SELECT 1 FROM drivers WHERE id = NEW.driver_id AND carrier_org_id = NEW.carrier_org_id) THEN
    RAISE EXCEPTION 'driver does not belong to this carrier' USING ERRCODE = '23514';
  END IF;
  IF NEW.vehicle_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id)
     AND NOT EXISTS (SELECT 1 FROM vehicles WHERE id = NEW.vehicle_id AND carrier_org_id = NEW.carrier_org_id) THEN
    RAISE EXCEPTION 'vehicle does not belong to this carrier' USING ERRCODE = '23514';
  END IF;
  IF NEW.customer_org_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.customer_org_id IS DISTINCT FROM OLD.customer_org_id)
     AND NOT EXISTS (SELECT 1 FROM customer_details WHERE org_id = NEW.customer_org_id AND carrier_org_id = NEW.carrier_org_id) THEN
    RAISE EXCEPTION 'customer does not belong to this carrier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER loads_reference_tenancy BEFORE INSERT OR UPDATE ON loads
  FOR EACH ROW EXECUTE FUNCTION enforce_load_reference_tenancy();

CREATE OR REPLACE FUNCTION enforce_contact_customer_tenancy() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.carrier_org_id IS DISTINCT FROM OLD.carrier_org_id)
     AND NOT EXISTS (SELECT 1 FROM customer_details WHERE org_id = NEW.org_id AND carrier_org_id = NEW.carrier_org_id) THEN
    RAISE EXCEPTION 'customer does not belong to this carrier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER customer_contacts_tenancy BEFORE INSERT OR UPDATE ON customer_contacts
  FOR EACH ROW EXECUTE FUNCTION enforce_contact_customer_tenancy();

-- ────────────────────────────────────────────────────────────
-- SECTION 20: DRIVER MESSAGE COLUMN GUARD (migration 0020; the split policies are on driver_messages above)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_driver_message_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF my_role() = 'driver' AND (to_jsonb(NEW) - 'read_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at') THEN
    RAISE EXCEPTION 'drivers may only mark messages read' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER driver_messages_columns BEFORE UPDATE ON driver_messages
  FOR EACH ROW EXECUTE FUNCTION enforce_driver_message_columns();

-- ────────────────────────────────────────────────────────────
-- SECTION 21: ENTITLEMENT DECISION + DATABASE-LEVEL TIER GATES (migration 0021)
-- Supersedes has_feature()/get_my_entitlements() from SECTION 8 and the IFTA/health-score functions above.
-- Mirrors server/domain/entitlement/model.ts; tests/entitlement-parity.test.ts keeps the two identical.
-- ────────────────────────────────────────────────────────────
-- Per-org, per-feature grant or deny, set by ShipmentX staff through the admin API. Server-only: no client role
-- can read or write it (same posture as change_events).
CREATE TABLE org_feature_overrides (
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature_key TEXT   NOT NULL REFERENCES features(key) ON DELETE CASCADE,
  effect      TEXT   NOT NULL CHECK (effect IN ('grant', 'deny')),
  reason      TEXT   NOT NULL,
  expires_at  TIMESTAMPTZ,
  set_by      UUID REFERENCES profiles(id),
  set_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, feature_key)
);
ALTER TABLE org_feature_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_feature_overrides FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_feature_overrides TO service_role;

-- The decision. Internal: takes an org id, so it is callable only by the server (service_role) and by the
-- SECURITY DEFINER wrappers below, never by a client with someone else's org id.
CREATE OR REPLACE FUNCTION entitlement_decision(p_org_id BIGINT, p_key TEXT)
RETURNS TABLE(allowed BOOLEAN, reason TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_flag_on   BOOLEAN;
  v_feature   features%ROWTYPE;
  v_cd        carrier_details%ROWTYPE;
  v_now       TIMESTAMPTZ := now();
BEGIN
  SELECT COALESCE(o.enabled, pf.default_enabled) INTO v_flag_on
    FROM platform_flags pf
    LEFT JOIN org_flag_overrides o ON o.flag_key = pf.flag_key AND o.org_id = p_org_id
   WHERE pf.flag_key = p_key;
  IF FOUND AND NOT v_flag_on THEN
    RETURN QUERY SELECT false, 'DISABLED_BY_PLATFORM_FLAG'; RETURN;
  END IF;

  SELECT * INTO v_feature FROM features WHERE key = p_key;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'UNKNOWN_CAPABILITY'; RETURN; END IF;

  SELECT * INTO v_cd FROM carrier_details WHERE org_id = p_org_id;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'NOT_A_CARRIER_ORG'; RETURN; END IF;

  IF EXISTS (SELECT 1 FROM org_feature_overrides
              WHERE org_id = p_org_id AND feature_key = p_key AND effect = 'deny'
                AND (expires_at IS NULL OR expires_at > v_now)) THEN
    RETURN QUERY SELECT false, 'DENIED_BY_OVERRIDE'; RETURN;
  END IF;

  -- Subscription standing. past_due with no grace set still works: the operator has a lever and hasn't pulled it.
  IF v_cd.billing_status = 'canceled' THEN
    IF v_feature.retained_when_delinquent THEN RETURN QUERY SELECT true, 'RETAINED_WHILE_DELINQUENT'; RETURN; END IF;
    RETURN QUERY SELECT false, 'SUBSCRIPTION_CANCELED'; RETURN;
  ELSIF v_cd.billing_status = 'trialing' AND v_cd.trial_ends_at IS NOT NULL AND v_cd.trial_ends_at <= v_now
        AND NOT (v_cd.grace_period_until IS NOT NULL AND v_cd.grace_period_until > v_now) THEN
    IF v_feature.retained_when_delinquent THEN RETURN QUERY SELECT true, 'RETAINED_WHILE_DELINQUENT'; RETURN; END IF;
    RETURN QUERY SELECT false, 'TRIAL_EXPIRED'; RETURN;
  ELSIF v_cd.billing_status = 'past_due' AND v_cd.grace_period_until IS NOT NULL AND v_cd.grace_period_until <= v_now THEN
    IF v_feature.retained_when_delinquent THEN RETURN QUERY SELECT true, 'RETAINED_WHILE_DELINQUENT'; RETURN; END IF;
    RETURN QUERY SELECT false, 'PAST_DUE_GRACE_EXPIRED'; RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM org_feature_overrides
              WHERE org_id = p_org_id AND feature_key = p_key AND effect = 'grant'
                AND (expires_at IS NULL OR expires_at > v_now)) THEN
    RETURN QUERY SELECT true, 'GRANTED_BY_OVERRIDE'; RETURN;
  END IF;

  IF (SELECT rank FROM tiers WHERE code = v_cd.tier) >= (SELECT rank FROM tiers WHERE code = v_feature.min_tier) THEN
    RETURN QUERY SELECT true, CASE
      WHEN v_cd.billing_status = 'trialing' THEN
        CASE WHEN v_cd.trial_ends_at IS NOT NULL AND v_cd.trial_ends_at <= v_now THEN 'WITHIN_GRACE_PERIOD' ELSE 'WITHIN_TRIAL' END
      WHEN v_cd.billing_status = 'past_due' THEN 'WITHIN_GRACE_PERIOD'
      ELSE 'INCLUDED_IN_TIER' END;
    RETURN;
  END IF;
  RETURN QUERY SELECT false, 'TIER_TOO_LOW';
END $$;
REVOKE EXECUTE ON FUNCTION entitlement_decision(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlement_decision(BIGINT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION has_feature(feature_key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT d.allowed FROM entitlement_decision(my_org_id(), feature_key) d), false);
$$;

CREATE OR REPLACE FUNCTION get_my_entitlements()
RETURNS TABLE(key TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.key FROM features f WHERE (SELECT d.allowed FROM entitlement_decision(my_org_id(), f.key) d);
$$;

-- Why a capability is unavailable, so a client can say "your trial ended" instead of a bare false.
CREATE OR REPLACE FUNCTION get_my_entitlement(p_key TEXT)
RETURNS TABLE(allowed BOOLEAN, reason TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.allowed, d.reason FROM entitlement_decision(my_org_id(), p_key) d;
$$;
REVOKE EXECUTE ON FUNCTION get_my_entitlement(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_my_entitlement(TEXT) TO authenticated;

-- Migration 0026: single resolver for the AUTHENTICATED app shell's branding tokens (Rule A's "one
-- resolver, not scattered" principle, architecture-principles.md, applied to branding rather than
-- status colors). NULLs every field when the org isn't entitled, so lib/branding.ts never re-derives
-- the has_feature() check itself.
CREATE OR REPLACE FUNCTION get_org_branding()
RETURNS TABLE(enabled BOOLEAN, logo_path TEXT, primary_color TEXT, accent_color TEXT)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    has_feature('branding_customization'),
    CASE WHEN has_feature('branding_customization') THEN o.logo_path ELSE NULL END,
    CASE WHEN has_feature('branding_customization') THEN cd.brand_primary_color ELSE NULL END,
    CASE WHEN has_feature('branding_customization') THEN cd.brand_accent_color ELSE NULL END
  FROM organizations o
  LEFT JOIN carrier_details cd ON cd.org_id = o.id
  WHERE o.id = my_org_id();
$$;
GRANT EXECUTE ON FUNCTION get_org_branding() TO authenticated;

-- The public tracking page (app/track/[token]/page.tsx) has NO auth session, so my_org_id() (which
-- has_feature()/get_org_branding() above depend on) resolves to NULL there. This replaces the BASIC
-- get_public_tracking() defined earlier in this file with one that also resolves branding, via
-- entitlement_decision(org_id, key) -- the org-id-parameterized primitive has_feature() itself now
-- delegates to (just above) -- since it's now defined and anon has no session to key my_org_id() off.
-- DROP + CREATE (not CREATE OR REPLACE) because the column list changed; Postgres refuses to replace a
-- function's OUT-parameter row type in place. Deliberately does not add a general anon SELECT policy on
-- carrier_details for this -- same reasoning get_public_tracking()'s original header comment already
-- gives for organizations.
DROP FUNCTION IF EXISTS get_public_tracking(TEXT);
CREATE FUNCTION get_public_tracking(p_token TEXT)
RETURNS TABLE(
  load_number          TEXT,
  status               TEXT,
  pickup_city          TEXT,
  pickup_state         TEXT,
  delivery_city        TEXT,
  delivery_state       TEXT,
  pickup_date          DATE,
  delivery_date        DATE,
  last_location_lat    NUMERIC,
  last_location_lng    NUMERIC,
  last_location_at     TIMESTAMPTZ,
  carrier_name         TEXT,
  carrier_phone        TEXT,
  carrier_email        TEXT,
  brand_logo_path      TEXT,
  brand_primary_color  TEXT,
  brand_accent_color   TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    l.load_number, l.status,
    l.pickup_city, l.pickup_state, l.delivery_city, l.delivery_state,
    l.pickup_date, l.delivery_date,
    l.last_location_lat, l.last_location_lng, l.last_location_at,
    o.name, o.phone, o.email,
    CASE WHEN (SELECT d.allowed FROM entitlement_decision(o.id, 'branding_customization') d)
         THEN o.logo_path ELSE NULL END,
    CASE WHEN (SELECT d.allowed FROM entitlement_decision(o.id, 'branding_customization') d)
         THEN cd.brand_primary_color ELSE NULL END,
    CASE WHEN (SELECT d.allowed FROM entitlement_decision(o.id, 'branding_customization') d)
         THEN cd.brand_accent_color ELSE NULL END
  FROM loads l
  JOIN organizations o ON o.id = l.carrier_org_id
  LEFT JOIN carrier_details cd ON cd.org_id = o.id
  WHERE l.tracking_token = p_token
$$;
GRANT EXECUTE ON FUNCTION get_public_tracking(TEXT) TO anon;

-- Write gates in the database, so a direct PostgREST call cannot skip what the API routes enforce. RESTRICTIVE
-- policies are ANDed with the existing permissive ones (no rewrite). Writes only: after a downgrade or lapse the
-- carrier can still READ what they already recorded, which is the behaviour a customer expects.
CREATE POLICY "tier_gate_driver_chat"       ON driver_messages    AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (has_feature('driver_chat'));
CREATE POLICY "tier_gate_settlements"       ON driver_settlements AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (has_feature('driver_settlements'));
CREATE POLICY "tier_gate_ifta_crossings"    ON ifta_state_crossings AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (has_feature('ifta_mileage_log'));
CREATE POLICY "tier_gate_load_expenses_ins" ON load_expenses      AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (has_feature('load_expenses'));
CREATE POLICY "tier_gate_load_expenses_upd" ON load_expenses      AS RESTRICTIVE FOR UPDATE TO authenticated USING (has_feature('load_expenses')) WITH CHECK (has_feature('load_expenses'));

-- SECURITY DEFINER paths bypass RLS, so they carry the check themselves. PT402 -> HTTP 402.
CREATE OR REPLACE FUNCTION replace_ifta_crossings_with_manual(
  p_load_id BIGINT,
  p_rows    JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org     BIGINT := my_org_id();
  v_vehicle BIGINT;
  v_driver  BIGINT;
  v_count   INTEGER;
BEGIN
  IF v_org IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  IF NOT caller_may_act_on_load(p_load_id) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
  END IF;

  IF NOT has_feature('ifta_mileage_log') THEN
    RAISE EXCEPTION 'TIER_UPGRADE_REQUIRED' USING ERRCODE = 'PT402';
  END IF;

  SELECT vehicle_id, driver_id INTO v_vehicle, v_driver
    FROM loads WHERE id = p_load_id AND carrier_org_id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
  END IF;

  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: rows must be a non-empty array' USING ERRCODE = 'PT400';
  END IF;

  DELETE FROM ifta_state_crossings WHERE load_id = p_load_id AND carrier_org_id = v_org AND source = 'gps';

  INSERT INTO ifta_state_crossings (carrier_org_id, vehicle_id, driver_id, load_id, state, odometer_est, crossed_at, source)
  SELECT v_org, v_vehicle, v_driver, p_load_id, upper(r.state), r.miles, now(), 'manual'
    FROM jsonb_to_recordset(p_rows) AS r(state TEXT, miles INTEGER)
   WHERE r.state ~ '^[A-Za-z]{2}$' AND r.miles IS NOT NULL AND r.miles > 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'VALIDATION: no valid rows' USING ERRCODE = 'PT400';
  END IF;
  RETURN v_count;
END $$;

-- The three read RPCs that were "enforced at the page level" now answer nothing below their tier.
CREATE OR REPLACE FUNCTION get_ifta_quarterly_summary(p_carrier_org_id BIGINT, p_quarter TEXT)
RETURNS TABLE(state TEXT, total_miles NUMERIC) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.state, SUM(c.odometer_est)::NUMERIC
  FROM ifta_state_crossings c
  WHERE c.carrier_org_id = p_carrier_org_id
    AND p_carrier_org_id = my_org_id()
    AND has_feature('ifta_mileage_log')
    AND to_char(c.crossed_at, '"Q"Q') = split_part(p_quarter, '-', 2)
    AND to_char(c.crossed_at, 'YYYY') = split_part(p_quarter, '-', 1)
  GROUP BY c.state;
$$;

CREATE OR REPLACE FUNCTION get_ifta_tax_summary(p_carrier_org_id BIGINT, p_quarter TEXT)
RETURNS TABLE(state TEXT, miles_in_state NUMERIC, net_tax_due NUMERIC) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_miles NUMERIC;
  v_total_fuel  NUMERIC;
BEGIN
  IF p_carrier_org_id != my_org_id() OR NOT has_feature('ifta_tax_hub') THEN
    RETURN;
  END IF;

  SELECT SUM(c.odometer_est) INTO v_total_miles
  FROM ifta_state_crossings c WHERE c.carrier_org_id = p_carrier_org_id;

  SELECT SUM(f.gallons) INTO v_total_fuel
  FROM fuel_stops f WHERE f.carrier_org_id = p_carrier_org_id;

  RETURN QUERY
  SELECT
    c.state,
    SUM(c.odometer_est)::NUMERIC AS miles_in_state,
    (
      (SUM(c.odometer_est) / NULLIF(v_total_miles, 0)) * COALESCE(v_total_fuel, 0) *
        COALESCE((SELECT rate_per_gallon FROM ifta_tax_rates WHERE ifta_tax_rates.state = c.state AND quarter = p_quarter), 0)
      -
      COALESCE((SELECT SUM(f2.gallons) FROM fuel_stops f2 WHERE f2.carrier_org_id = p_carrier_org_id AND f2.state = c.state), 0)
        * COALESCE((SELECT rate_per_gallon FROM ifta_tax_rates WHERE ifta_tax_rates.state = c.state AND quarter = p_quarter), 0)
    )::NUMERIC AS net_tax_due
  FROM ifta_state_crossings c
  WHERE c.carrier_org_id = p_carrier_org_id
  GROUP BY c.state;
END;
$$;

CREATE OR REPLACE FUNCTION get_customer_health_score(customer_org_id BIGINT)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_paid_total   INT;
  v_paid_on_time INT;
  v_payment_pct  NUMERIC;
  v_exception_ct INT;
  v_exception_pct NUMERIC;
BEGIN
  IF NOT has_feature('customer_health_score') THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE due_date IS NOT NULL),
    COUNT(*) FILTER (WHERE due_date IS NOT NULL AND paid_at IS NOT NULL AND paid_at::DATE <= due_date)
  INTO v_paid_total, v_paid_on_time
  FROM invoices
  WHERE invoices.customer_org_id = get_customer_health_score.customer_org_id
    AND carrier_org_id = my_org_id()
    AND status = 'paid';

  v_payment_pct := CASE WHEN v_paid_total > 0
    THEN (v_paid_on_time::NUMERIC / v_paid_total) * 100
    ELSE 100
  END;

  SELECT COUNT(*)
  INTO v_exception_ct
  FROM exception_events
  WHERE exception_events.entity_type = 'customer'
    AND exception_events.entity_id = get_customer_health_score.customer_org_id
    AND carrier_org_id = my_org_id()
    AND occurred_at >= now() - INTERVAL '90 days';

  v_exception_pct := GREATEST(0, 100 - (LEAST(v_exception_ct, 10) * 10));

  RETURN ROUND((v_payment_pct * 0.7) + (v_exception_pct * 0.3));
END;
$$;

-- ────────────────────────────────────────────────────────────
-- SECTION 22: ROLE-SCOPED READS (migration 0022)
-- The policy rewrites (is_active-aware helpers, role-scoped reads) are edited IN PLACE next to their tables above;
-- this section holds the trigger and function changes. get_exceptions() supersedes the earlier definition.
-- ────────────────────────────────────────────────────────────
-- 3. Finance: status to invoiced/paid only. Same technique as 0018 (RLS cannot say which columns).
CREATE OR REPLACE FUNCTION enforce_finance_load_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_ignored TEXT[] := ARRAY['status', 'updated_at'];
BEGIN
  IF my_role() = 'finance' THEN
    IF (to_jsonb(NEW) - v_ignored) IS DISTINCT FROM (to_jsonb(OLD) - v_ignored) THEN
      RAISE EXCEPTION 'finance may only change a load''s billing status' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('invoiced', 'paid') THEN
      RAISE EXCEPTION 'finance may only move a load to invoiced or paid' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER loads_finance_columns BEFORE UPDATE ON loads
  FOR EACH ROW EXECUTE FUNCTION enforce_finance_load_columns();

-- 4. Office roles only.
CREATE OR REPLACE FUNCTION mark_overdue_invoices()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF my_role() IS NULL OR my_role() NOT IN ('owner', 'solo', 'dispatcher', 'finance') THEN
    RETURN 0;
  END IF;
  UPDATE invoices SET status = 'overdue'
  WHERE status = 'sent' AND due_date < CURRENT_DATE
    AND carrier_org_id = my_org_id();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- get_exceptions(): the existing body moves to an internal function that no client role can call; the public name
-- becomes a role-checked wrapper with the same signature.
CREATE OR REPLACE FUNCTION public.get_exceptions_unchecked()
 RETURNS TABLE(entity_type text, entity_id bigint, exception_type text, tier text, title text, detail text, due_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

  -- 1) INVOICES: overdue, or about to become overdue. No "upcoming" tier --
  -- an invoice not yet due within a week isn't an exception yet.
  SELECT
    'invoice'::TEXT,
    i.id,
    'invoice_overdue'::TEXT,
    CASE WHEN i.due_date < CURRENT_DATE THEN 'today' ELSE 'this_week' END,
    'Invoice overdue'::TEXT,
    'Invoice ' || i.invoice_number || ' for $' || i.amount || ' due ' || to_char(i.due_date, 'Mon DD, YYYY'),
    i.due_date::TIMESTAMPTZ
  FROM invoices i
  WHERE i.carrier_org_id = my_org_id()
    AND i.status IN ('sent', 'overdue')
    AND i.due_date IS NOT NULL
    AND i.due_date <= CURRENT_DATE + INTERVAL '7 days'

  UNION ALL

  -- 2) ORG DOCUMENTS: carrier's own compliance docs (COI, MC authority, UCR,
  -- etc.) -- these are typically annual filings, so the "upcoming" horizon
  -- is the widest of the doc branches (180 days, per the UCR-style hint).
  -- entity_type is 'organization', NOT 'customer' -- this branch is scoped
  -- to `od.org_id = my_org_id()`, i.e. the CARRIER's own org, never an
  -- actual customer org. Bug found 2026-07-21: it was originally mislabeled
  -- 'customer', which meant these exceptions silently could never match any
  -- customer-entity filter anywhere in the app (there's no page that lists
  -- exceptions for the carrier's own org itself, only the aggregate inbox/
  -- banner, which don't filter by entity_type -- so this only ever broke a
  -- hypothetical future per-entity view, not anything currently built).
  SELECT
    'organization'::TEXT,
    od.org_id,
    CASE WHEN od.expiry_date < CURRENT_DATE THEN 'doc_expired' ELSE 'doc_expiring' END,
    CASE
      WHEN od.expiry_date < CURRENT_DATE THEN 'today'
      WHEN od.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    CASE WHEN od.expiry_date < CURRENT_DATE THEN 'Compliance document expired' ELSE 'Compliance document expiring' END,
    COALESCE(od.label, od.doc_type) || ' expires ' || to_char(od.expiry_date, 'Mon DD, YYYY'),
    od.expiry_date::TIMESTAMPTZ
  FROM org_documents od
  WHERE od.org_id = my_org_id()
    AND od.expiry_date IS NOT NULL
    AND od.expiry_date <= CURRENT_DATE + INTERVAL '180 days'

  UNION ALL

  -- 3) VEHICLE DOCUMENTS: registration/insurance/DOT authority/annual
  -- inspection -- a middle horizon (60 days) between CDL (30) and the
  -- UCR-style org docs (180); these are typically renewed annually but
  -- carriers plan for them further ahead than a driver's own CDL.
  SELECT
    'vehicle'::TEXT,
    vd.vehicle_id,
    CASE WHEN vd.expiry_date < CURRENT_DATE THEN 'doc_expired' ELSE 'doc_expiring' END,
    CASE
      WHEN vd.expiry_date < CURRENT_DATE THEN 'today'
      WHEN vd.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    CASE WHEN vd.expiry_date < CURRENT_DATE THEN 'Vehicle document expired' ELSE 'Vehicle document expiring' END,
    v.nickname || ': ' || COALESCE(vd.label, vd.doc_type) || ' expires ' || to_char(vd.expiry_date, 'Mon DD, YYYY'),
    vd.expiry_date::TIMESTAMPTZ
  FROM vehicle_documents vd
  JOIN vehicles v ON v.id = vd.vehicle_id
  WHERE vd.carrier_org_id = my_org_id()
    AND vd.expiry_date IS NOT NULL
    AND vd.expiry_date <= CURRENT_DATE + INTERVAL '60 days'

  UNION ALL

  -- 4) DRIVER CDL EXPIRY: authoritative structured field (drivers.cdl_expiry),
  -- not driver_documents -- see function-level note above. 30-day horizon
  -- per the CDL-specific hint.
  SELECT
    'driver'::TEXT,
    d.id,
    'cdl_expiring'::TEXT,
    CASE
      WHEN d.cdl_expiry < CURRENT_DATE THEN 'today'
      WHEN d.cdl_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    'CDL expiring'::TEXT,
    trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) || '''s CDL expires ' || to_char(d.cdl_expiry, 'Mon DD, YYYY'),
    d.cdl_expiry::TIMESTAMPTZ
  FROM drivers d
  JOIN profiles p ON p.id = d.profile_id
  WHERE d.carrier_org_id = my_org_id()
    AND d.cdl_expiry IS NOT NULL
    AND d.cdl_expiry <= CURRENT_DATE + INTERVAL '30 days'

  UNION ALL

  -- 5) DRIVER MEDICAL CERT EXPIRY: same authoritative-field reasoning as CDL
  -- above, same 30-day horizon (DOT physicals are typically flagged on a
  -- similarly short runway).
  SELECT
    'driver'::TEXT,
    d.id,
    'med_cert_expiring'::TEXT,
    CASE
      WHEN d.med_cert_expiry < CURRENT_DATE THEN 'today'
      WHEN d.med_cert_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    'Medical certificate expiring'::TEXT,
    trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) || '''s medical certificate expires ' || to_char(d.med_cert_expiry, 'Mon DD, YYYY'),
    d.med_cert_expiry::TIMESTAMPTZ
  FROM drivers d
  JOIN profiles p ON p.id = d.profile_id
  WHERE d.carrier_org_id = my_org_id()
    AND d.med_cert_expiry IS NOT NULL
    AND d.med_cert_expiry <= CURRENT_DATE + INTERVAL '30 days'

  UNION ALL

  -- 6) POD MISSING: a load marked delivered with no matching 'pod'-type
  -- document row. No natural due date to look forward to (delivery already
  -- happened), so tiering instead reflects how overdue the paperwork is: a
  -- 2-day grace period after delivery before this escalates from
  -- 'this_week' to 'today'. due_at is the delivery date (when the POD
  -- should have been captured), falling back to updated_at if delivery_date
  -- was never recorded.
  SELECT
    'load'::TEXT,
    l.id,
    'pod_missing'::TEXT,
    CASE
      WHEN l.delivery_date IS NULL OR l.delivery_date <= CURRENT_DATE - INTERVAL '2 days' THEN 'today'
      ELSE 'this_week'
    END,
    'POD missing'::TEXT,
    'Load ' || l.load_number || ' delivered without a proof of delivery',
    COALESCE(l.delivery_date::TIMESTAMPTZ, l.updated_at)
  FROM loads l
  WHERE l.carrier_org_id = my_org_id()
    AND l.status = 'delivered'
    AND NOT EXISTS (
      SELECT 1 FROM documents doc WHERE doc.load_id = l.id AND doc.type = 'pod'
    )

  UNION ALL

  -- 7) MAINTENANCE DUE: date-based reminders only -- see function-level note
  -- on next_due_miles above. entity_type is 'vehicle' (the reminder is about
  -- the vehicle, not a standalone entity of its own). 30-day horizon, same
  -- reasoning as CDL: maintenance intervals are usually planned on a
  -- similarly short runway, not an annual one.
  SELECT
    'vehicle'::TEXT,
    mr.vehicle_id,
    'maintenance_due'::TEXT,
    CASE
      WHEN mr.next_due_date < CURRENT_DATE THEN 'today'
      WHEN mr.next_due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    'Maintenance due'::TEXT,
    v.nickname || ': ' || mr.reminder_type || ' due ' || to_char(mr.next_due_date, 'Mon DD, YYYY'),
    mr.next_due_date::TIMESTAMPTZ
  FROM maintenance_reminders mr
  JOIN vehicles v ON v.id = mr.vehicle_id
  WHERE mr.carrier_org_id = my_org_id()
    AND mr.is_active = true
    AND mr.next_due_date IS NOT NULL
    AND mr.next_due_date <= CURRENT_DATE + INTERVAL '30 days'

$function$;
REVOKE EXECUTE ON FUNCTION get_exceptions_unchecked() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION get_exceptions()
RETURNS TABLE(entity_type TEXT, entity_id BIGINT, exception_type TEXT, tier TEXT, title TEXT, detail TEXT, due_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM get_exceptions_unchecked() WHERE my_role() IN ('owner', 'solo', 'dispatcher', 'finance');
$$;

-- ────────────────────────────────────────────────────────────
-- SECTION 23: PUBLIC DEVELOPER API (migration 0025)
--
-- Phase 9: external callers authenticate as an ORGANIZATION via an OAuth 2.0 client-credentials grant
-- (client_id/client_secret), never as a logged-in human with a Supabase session. Nothing here is reachable
-- by `authenticated`/`anon`: the app talks to these tables only via the service-role admin client (same
-- posture as change_events/idempotency_keys), because there is no Supabase user session for RLS to key off
-- for this caller. Tier gate (`public_api`, min_tier growth) is seeded next to `features` above.
-- ────────────────────────────────────────────────────────────

-- One org can hold several named clients (rotate/revoke independently without losing all API access).
-- client_secret_hash is bcrypt -- the raw secret is shown to the user exactly once, at creation, and never
-- stored or logged anywhere after that.
CREATE TABLE oauth_clients (
  id                 BIGSERIAL PRIMARY KEY,
  org_id             BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id          TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT NOT NULL,
  name               TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at       TIMESTAMPTZ,
  -- NULL = active. A revoked client's credentials must never mint a new token again (checked at token-issue
  -- time); a token already issued before revocation still expires naturally within its 1h lifetime -- the
  -- same "good until it expires" posture as the tier-downgrade case, not a gap specific to revocation.
  revoked_at         TIMESTAMPTZ
);
CREATE INDEX idx_oauth_clients_org ON oauth_clients(org_id);
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oauth_clients FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON oauth_clients TO service_role;
GRANT USAGE, SELECT ON SEQUENCE oauth_clients_id_seq TO service_role;

COMMENT ON TABLE oauth_clients IS
  'Public developer API (Phase 9) OAuth 2.0 client-credentials clients, one org : many clients. Server-only -- no client role can read or write it, same posture as change_events/idempotency_keys.';

-- Fixed-window rate-limit counter per client_id, enforced in Postgres (no Redis -- this app already leans on
-- Postgres for shared counters, e.g. next_entity_val()/org_sequences). One row per (client, window); the
-- window is truncated to p_window_seconds so concurrent requests across multiple app instances (ECS
-- autoscaling) increment the SAME row and race safely through the atomic INSERT .. ON CONFLICT below --
-- no in-process counter, which would be wrong the moment there is more than one instance.
--
-- client_id is deliberately NOT a foreign key to oauth_clients: the token endpoint rate-limits by the
-- CLAIMED client_id before it has verified that client exists (so repeated guesses against a bogus or
-- not-yet-created id are throttled too, not just guesses against a real one) -- an FK here would turn every
-- such request into a 500 instead of the intended 401/429.
--
-- v1 scope cut: no scheduled cleanup of old window rows (same posture as send-reminders' cron not being
-- wired to a scheduler yet -- see app/api/cron/send-reminders/route.ts). At 100 req/min per client this is a
-- few hundred KB per client per day; revisit if/when a real cron runner exists.
CREATE TABLE oauth_client_rate_limits (
  client_id     TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  request_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, window_start)
);
ALTER TABLE oauth_client_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oauth_client_rate_limits FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON oauth_client_rate_limits TO service_role;

COMMENT ON TABLE oauth_client_rate_limits IS
  'Fixed-window request counters backing the public API''s 100 req/min per-client rate limit. Server-only.';

-- Atomic check-and-increment: one statement, so concurrent requests for the same client (whether same
-- process or a different ECS task) serialize through Postgres row locking on the ON CONFLICT target rather
-- than racing a read-then-write in application code.
CREATE OR REPLACE FUNCTION check_public_api_rate_limit(p_client_id TEXT, p_window_seconds INT, p_limit INT)
RETURNS TABLE(allowed BOOLEAN, current_count INT, retry_after_seconds INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count        INT;
BEGIN
  v_window_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO oauth_client_rate_limits (client_id, window_start, request_count)
  VALUES (p_client_id, v_window_start, 1)
  ON CONFLICT (client_id, window_start)
  DO UPDATE SET request_count = oauth_client_rate_limits.request_count + 1
  RETURNING oauth_client_rate_limits.request_count INTO v_count;

  RETURN QUERY SELECT
    v_count <= p_limit,
    v_count,
    CASE WHEN v_count <= p_limit THEN 0
         ELSE GREATEST(1, CEIL(p_window_seconds - extract(epoch FROM (now() - v_window_start)))::INT)
    END;
END;
$$;
REVOKE ALL ON FUNCTION check_public_api_rate_limit(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- SECTION 24: SUPPORT TICKETING (migration 0027)
--
-- In-app support ticketing with AI triage routing (decisions.md T16). Resolves PR1's "dedicated
-- support" half of Enterprise's originally-undefined "white-label + dedicated support" line (the
-- other half, branding, was migration 0026/SECTION 1b's branding_customization feature row).
--
-- Three-queue model: carrieros_support (CarrierOS's own platform-staff queue, sx_owner/sx_support,
-- every tier) / org_support (the submitting org's own staff, Enterprise-gated via
-- has_feature('support_desk')) / ai_resolved (auto-answered above a confidence threshold, with
-- fallback_queue recording where a "still need help?" escalation reopens to). See
-- lib/support-triage.ts for the classification call this table's rows are written from.
--
-- Placed here (appended, not merged into SECTION 2/3's table blocks) because it must come after
-- SECTION 8c's blanket base-table GRANT and after my_org_id()/my_role()/has_feature() -- same
-- placement reasoning SECTION 23 (public developer API) already established for a new table added
-- post-SECTION-8c; this table needs its OWN explicit GRANT below since the blanket statement earlier
-- in the file only covers tables that existed at that point in a top-to-bottom replay.
-- ────────────────────────────────────────────────────────────

CREATE TABLE support_tickets (
  id                   BIGSERIAL PRIMARY KEY,
  submitted_by         UUID NOT NULL REFERENCES profiles(id),
  carrier_org_id       BIGINT NOT NULL REFERENCES organizations(id),
  -- Identity/context captured automatically at submission time (never asked of the user directly,
  -- per T16's explicit "record details about them... ask the right question" framing) — snapshotted
  -- rather than joined live so a later role change or tier change doesn't rewrite ticket history.
  submitter_role       TEXT NOT NULL,
  submitter_tier       TEXT,   -- carrier_details.tier at submission time; NULL for non-carrier (platform-org) submitters
  category             TEXT NOT NULL CHECK (category IN (
    'technical_issue','load_dispatch','account_billing','compliance_safety','driver_pay_hr','feature_request','other'
  )),
  related_load_number  TEXT,   -- conditional field, shown client-side only for category = 'load_dispatch'
  body                 TEXT NOT NULL,
  queue                TEXT NOT NULL CHECK (queue IN ('carrieros_support','org_support','ai_resolved')),
  -- Only set when queue = 'ai_resolved' — the human queue the classifier would have routed to had it
  -- not auto-resolved. escalate_support_ticket() reopens into exactly this queue (T16: "reopens it
  -- into whichever queue the original classification pointed at").
  fallback_queue       TEXT CHECK (fallback_queue IN ('carrieros_support','org_support')),
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','closed')),
  ai_confidence        NUMERIC CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  ai_answer            TEXT,   -- populated when queue = 'ai_resolved'; also mirrored into the first thread message
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at          TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fallback_queue_only_when_ai_resolved CHECK (
    (queue = 'ai_resolved' AND fallback_queue IS NOT NULL) OR
    (queue <> 'ai_resolved' AND fallback_queue IS NULL)
  )
);

-- Short-lived, actor-bound support inspection; never authenticates as the tenant user.
CREATE TABLE admin_support_access_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id BIGINT REFERENCES support_tickets(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) BETWEEN 10 AND 500),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  ended_at TIMESTAMPTZ,
  ended_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_support_access_expiry_window CHECK (
    expires_at > started_at AND expires_at <= started_at + interval '15 minutes'
  )
);
COMMENT ON TABLE admin_support_access_sessions IS
  'Actor-bound, read-only SX support inspection sessions; never authenticates as or mutates the target user.';
CREATE INDEX idx_admin_support_access_admin_active
  ON admin_support_access_sessions(admin_id, expires_at DESC)
  WHERE ended_at IS NULL;
CREATE INDEX idx_admin_support_access_org_started
  ON admin_support_access_sessions(org_id, started_at DESC);
ALTER TABLE admin_support_access_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_support_access_sessions FROM anon, authenticated;
GRANT SELECT, INSERT ON admin_support_access_sessions TO service_role;
GRANT UPDATE (ended_at, ended_by, last_accessed_at) ON admin_support_access_sessions TO service_role;

COMMENT ON TABLE support_tickets IS
  'In-app support ticketing (decisions.md T16). AI-triaged into carrieros_support/org_support/ai_resolved on creation — see lib/support-triage.ts. RLS: submitter sees own; org_support staff (owner/solo, Enterprise-gated) see their own org''s org_support-queue tickets only; sx_owner/sx_support see carrieros_support-queue tickets regardless of org (mirrors admin_notes'' "gated on my_role() alone" precedent, SECTION 3c).';

CREATE INDEX idx_support_tickets_org           ON support_tickets(carrier_org_id);
CREATE INDEX idx_support_tickets_submitter     ON support_tickets(submitted_by);
CREATE INDEX idx_support_tickets_queue_status  ON support_tickets(queue, status);

CREATE TABLE support_ticket_messages (
  id              BIGSERIAL PRIMARY KEY,
  ticket_id       BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  carrier_org_id  BIGINT NOT NULL REFERENCES organizations(id),
  sender_id       UUID REFERENCES profiles(id),   -- NULL = AI-generated or system message
  is_ai_generated BOOLEAN NOT NULL DEFAULT false,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE support_ticket_messages IS
  'Reply thread for support_tickets (decisions.md T16). sender_id NULL + is_ai_generated true = the auto-answer message inserted alongside an ai_resolved ticket.';

CREATE INDEX idx_support_ticket_messages_ticket ON support_ticket_messages(ticket_id);
CREATE INDEX idx_support_ticket_messages_org    ON support_ticket_messages(carrier_org_id);

CREATE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "submitter_creates_own_ticket" ON support_tickets FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid() AND carrier_org_id = my_org_id());

CREATE POLICY "submitter_own_tickets_select" ON support_tickets FOR SELECT TO authenticated
  USING (submitted_by = auth.uid());

CREATE POLICY "org_support_staff_select" ON support_tickets FOR SELECT TO authenticated
  USING (
    queue = 'org_support'
    AND carrier_org_id = my_org_id()
    AND my_role() IN ('owner','solo')
    AND has_feature('support_desk')
  );
CREATE POLICY "org_support_staff_update" ON support_tickets FOR UPDATE TO authenticated
  USING (
    queue = 'org_support'
    AND carrier_org_id = my_org_id()
    AND my_role() IN ('owner','solo')
    AND has_feature('support_desk')
  )
  WITH CHECK (
    queue = 'org_support'
    AND carrier_org_id = my_org_id()
    AND my_role() IN ('owner','solo')
    AND has_feature('support_desk')
  );

-- carrieros_support tickets are NOT scoped to ShipmentX's own org_id -- they're submitted by carrier-
-- org users and routed to ShipmentX's queue, the same "gated on my_role() alone, no org-membership
-- check" shape admin_notes already uses (SECTION 3c) and for the identical reason: only a trusted
-- action ever assigns an sx_* role. app/api/admin/support-tickets/** routes use the service-role
-- admin client per lib/admin-auth.ts convention regardless; this is defense in depth / consistency
-- with that existing precedent, not the only enforcement point.
CREATE POLICY "sx_carrieros_support_select" ON support_tickets FOR SELECT TO authenticated
  USING (queue = 'carrieros_support' AND my_role() IN ('sx_owner','sx_support'));
CREATE POLICY "sx_carrieros_support_update" ON support_tickets FOR UPDATE TO authenticated
  USING (queue = 'carrieros_support' AND my_role() IN ('sx_owner','sx_support'))
  WITH CHECK (queue = 'carrieros_support' AND my_role() IN ('sx_owner','sx_support'));

ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_owner_messages_select" ON support_ticket_messages FOR SELECT TO authenticated
  USING (ticket_id IN (SELECT id FROM support_tickets WHERE submitted_by = auth.uid()));

CREATE POLICY "ticket_owner_messages_insert" ON support_ticket_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND carrier_org_id = my_org_id()
    AND ticket_id IN (SELECT id FROM support_tickets WHERE submitted_by = auth.uid())
  );

CREATE POLICY "org_support_staff_messages_select" ON support_ticket_messages FOR SELECT TO authenticated
  USING (
    carrier_org_id = my_org_id()
    AND my_role() IN ('owner','solo')
    AND has_feature('support_desk')
    AND ticket_id IN (SELECT id FROM support_tickets WHERE queue = 'org_support')
  );
CREATE POLICY "org_support_staff_messages_insert" ON support_ticket_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND carrier_org_id = my_org_id()
    AND my_role() IN ('owner','solo')
    AND has_feature('support_desk')
    AND ticket_id IN (SELECT id FROM support_tickets WHERE queue = 'org_support')
  );

CREATE POLICY "sx_carrieros_support_messages_select" ON support_ticket_messages FOR SELECT TO authenticated
  USING (
    my_role() IN ('sx_owner','sx_support')
    AND ticket_id IN (SELECT id FROM support_tickets WHERE queue = 'carrieros_support')
  );
CREATE POLICY "sx_carrieros_support_messages_insert" ON support_ticket_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND my_role() IN ('sx_owner','sx_support')
    AND ticket_id IN (SELECT id FROM support_tickets WHERE queue = 'carrieros_support')
  );

-- New tables added after SECTION 8c's blanket GRANT already ran (in a top-to-bottom replay of THIS
-- file) need their own explicit grant, same requirement migration 0009 hit for role_capabilities and
-- migration 0025/SECTION 23 hit for oauth_clients. RLS above is what actually restricts access.
GRANT SELECT, INSERT, UPDATE, DELETE ON support_tickets, support_ticket_messages TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE support_tickets_id_seq, support_ticket_messages_id_seq TO authenticated, service_role;

-- Escalation RPC -- "still need help?" on an ai_resolved ticket (T16: never a dead end). A plain RLS
-- UPDATE policy could let a submitter set queue/status to anything reachable from their own row; this
-- is a real state transition (queue AND status change together, only from a specific prior state) so
-- it's a SECURITY DEFINER RPC instead, same idiom as submit_dvir_inspection()/log_vehicle_service()
-- (SECTION 17/15) for real business-logic transitions rather than a raw table write.
CREATE OR REPLACE FUNCTION escalate_support_ticket(p_ticket_id BIGINT)
RETURNS support_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket support_tickets;
BEGIN
  SELECT * INTO v_ticket FROM support_tickets WHERE id = p_ticket_id AND submitted_by = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_ticket.queue <> 'ai_resolved' OR v_ticket.fallback_queue IS NULL THEN
    RAISE EXCEPTION 'Ticket is not eligible for escalation' USING ERRCODE = '22023';
  END IF;

  UPDATE support_tickets
  SET queue = v_ticket.fallback_queue,
      fallback_queue = NULL,  -- the fallback_queue_only_when_ai_resolved CHECK requires this once queue is no longer ai_resolved
      status = 'open',
      resolved_at = NULL
  WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  INSERT INTO support_ticket_messages (ticket_id, carrier_org_id, sender_id, is_ai_generated, body)
  VALUES (p_ticket_id, v_ticket.carrier_org_id, auth.uid(), false, '[Escalated to a human — still need help with this.]');

  RETURN v_ticket;
END;
$$;
GRANT EXECUTE ON FUNCTION escalate_support_ticket(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_public_api_rate_limit(TEXT, INT, INT) TO service_role;

-- ────────────────────────────────────────────────────────────
-- SECTION 25: AI PROVIDER CONFIG (migrations 0031, 0032)
--
-- Platform-wide LLM provider abstraction (decisions.md T17). Both real LLM integrations (T6 load
-- extraction, T16 support-ticket triage) move off a hardcoded `@anthropic-ai/sdk` call onto the new
-- lib/ai/ provider abstraction -- this table is the config side: a single, platform-wide (NOT
-- per-org) row picking which provider is active. See lib/ai/index.ts (getActiveLLMProvider()).
--
-- Singleton-row pattern (id BIGINT PRIMARY KEY DEFAULT 1 CHECK (id = 1)) -- exactly one row, ever,
-- enforced by the CHECK rather than just convention.
--
-- Where credentials live (migration 0031, amended by 0032 per T17's 2026-09-22 amendment): a
-- provider's key can now be set from the SuperAdmin console, stored ENCRYPTED (AES-256-GCM, app-layer
-- via lib/crypto/secrets.ts, never Postgres pgcrypto -- the plaintext never crosses into a SQL
-- statement) in the `*_api_key_encrypted` columns below. An environment variable
-- (ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENAI_COMPATIBLE_API_KEY, the last one optional) remains a
-- valid FALLBACK, checked only when no encrypted DB value is set -- additive, not a replacement. The
-- `*_api_key_preview` columns hold only the plaintext key's last 4 characters, so GET
-- /api/admin/ai-config can render a masked preview without ever decrypting -- decryption happens only
-- in lib/ai/*-provider.ts at actual LLM-call time, never in the admin route (T17 amendment: no
-- "reveal" affordance anywhere). This table still holds no full credential in readable form anywhere.
--
-- Default provider 'openai' (T17's new default), default model 'gpt-5-mini' (the fast/cheap tier,
-- same reasoning T6 originally picked claude-haiku-4-5 over a larger Claude model for).
--
-- Server-only, same posture as change_events/idempotency_keys/oauth_clients (SECTION 23) -- no
-- authenticated/anon grant at all; read via lib/ai/index.ts's service-role admin client, written via
-- app/api/admin/ai-config/route.ts (requireAdminRole(request, 'admin_ai_config'), sx_owner only).
-- ────────────────────────────────────────────────────────────

CREATE TABLE ai_provider_config (
  id                                    BIGINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider                              TEXT NOT NULL DEFAULT 'openai' CHECK (provider IN ('anthropic', 'openai', 'openai_compatible')),
  model                                 TEXT NOT NULL DEFAULT 'gpt-5-mini',
  compatible_base_url                   TEXT,
  -- Encrypted-at-rest provider API keys (migration 0032) -- see SECTION header above for the full
  -- scheme. *_api_key_encrypted is AES-256-GCM ciphertext (base64(IV||authTag||ciphertext));
  -- *_api_key_preview is the plaintext last 4 characters only, for masked display. Each pair is
  -- always both NULL or both set together (CHECK below).
  anthropic_api_key_encrypted           TEXT,
  anthropic_api_key_preview             TEXT,
  openai_api_key_encrypted              TEXT,
  openai_api_key_preview                TEXT,
  openai_compatible_api_key_encrypted   TEXT,
  openai_compatible_api_key_preview     TEXT,
  updated_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                            UUID REFERENCES profiles(id),
  CONSTRAINT compatible_base_url_required_for_openai_compatible CHECK (
    (provider = 'openai_compatible' AND compatible_base_url IS NOT NULL AND compatible_base_url <> '')
    OR (provider <> 'openai_compatible')
  ),
  CONSTRAINT anthropic_api_key_preview_matches_encrypted CHECK (
    (anthropic_api_key_encrypted IS NULL) = (anthropic_api_key_preview IS NULL)
  ),
  CONSTRAINT openai_api_key_preview_matches_encrypted CHECK (
    (openai_api_key_encrypted IS NULL) = (openai_api_key_preview IS NULL)
  ),
  CONSTRAINT openai_compatible_api_key_preview_matches_encrypted CHECK (
    (openai_compatible_api_key_encrypted IS NULL) = (openai_compatible_api_key_preview IS NULL)
  )
);

COMMENT ON TABLE ai_provider_config IS
  'Singleton row (id always 1) selecting the platform-wide active LLM provider (decisions.md T17). Provider API keys may be set encrypted-at-rest from the admin console (migration 0032, AES-256-GCM via lib/crypto/secrets.ts) or fall back to an environment variable when unset -- never a plaintext credential in this table. Changed only via PUT /api/admin/ai-config, sx_owner only (admin_ai_config capability).';
COMMENT ON COLUMN ai_provider_config.anthropic_api_key_encrypted IS
  'AES-256-GCM ciphertext (lib/crypto/secrets.ts), base64(IV||authTag||ciphertext). NULL means "no DB-stored key -- fall back to ANTHROPIC_API_KEY env var". Decrypted only by lib/ai/anthropic-provider.ts at LLM-call time, never in the admin route.';
COMMENT ON COLUMN ai_provider_config.anthropic_api_key_preview IS
  'Plaintext last 4 characters of the currently-stored key, for GET /api/admin/ai-config''s masked preview ("••••••••" + this). Never the full key. NULL iff anthropic_api_key_encrypted is NULL.';
COMMENT ON COLUMN ai_provider_config.openai_api_key_encrypted IS
  'Same scheme as anthropic_api_key_encrypted. NULL falls back to OPENAI_API_KEY env var.';
COMMENT ON COLUMN ai_provider_config.openai_api_key_preview IS
  'Same scheme as anthropic_api_key_preview, for the openai provider.';
COMMENT ON COLUMN ai_provider_config.openai_compatible_api_key_encrypted IS
  'Same scheme as anthropic_api_key_encrypted. NULL falls back to the optional OPENAI_COMPATIBLE_API_KEY env var (self-hosted endpoints often need no key at all, unchanged from migration 0031).';
COMMENT ON COLUMN ai_provider_config.openai_compatible_api_key_preview IS
  'Same scheme as anthropic_api_key_preview, for the openai_compatible provider.';

INSERT INTO ai_provider_config (id) VALUES (1);

CREATE TRIGGER ai_provider_config_updated_at
  BEFORE UPDATE ON ai_provider_config FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE ai_provider_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_provider_config FROM anon, authenticated;
GRANT SELECT, UPDATE ON ai_provider_config TO service_role;

-- Per-feature LLM override on top of ai_provider_config's default (migration
-- 0036). No row for a feature = use the global default. A row's presence is a
-- full override, never a partial merge -- same self-contained-row philosophy
-- as ai_provider_config. feature is CHECK-constrained so a typo can't create
-- a dead override no code reads.
CREATE TABLE ai_feature_overrides (
  feature                              TEXT PRIMARY KEY CHECK (feature IN ('translation')),
  provider                             TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai', 'openai_compatible')),
  model                                TEXT NOT NULL,
  compatible_base_url                  TEXT,
  anthropic_api_key_encrypted          TEXT,
  anthropic_api_key_preview            TEXT,
  openai_api_key_encrypted             TEXT,
  openai_api_key_preview               TEXT,
  openai_compatible_api_key_encrypted  TEXT,
  openai_compatible_api_key_preview    TEXT,
  updated_at                           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                           UUID REFERENCES profiles(id),
  CONSTRAINT compatible_base_url_required_for_openai_compatible CHECK (
    (provider = 'openai_compatible' AND compatible_base_url IS NOT NULL AND compatible_base_url <> '')
    OR (provider <> 'openai_compatible')
  ),
  CONSTRAINT anthropic_api_key_preview_matches_encrypted CHECK (
    (anthropic_api_key_encrypted IS NULL) = (anthropic_api_key_preview IS NULL)
  ),
  CONSTRAINT openai_api_key_preview_matches_encrypted CHECK (
    (openai_api_key_encrypted IS NULL) = (openai_api_key_preview IS NULL)
  ),
  CONSTRAINT openai_compatible_api_key_preview_matches_encrypted CHECK (
    (openai_compatible_api_key_encrypted IS NULL) = (openai_compatible_api_key_preview IS NULL)
  )
);

COMMENT ON TABLE ai_feature_overrides IS
  'Per-feature LLM override on top of ai_provider_config''s platform-wide default. No row for a feature = use the global config. Never holds a credential in the clear -- same encrypted-key/preview-pair scheme as ai_provider_config (migration 0032). Changed only via /api/admin/ai-config/features/{feature}, sx_owner only (admin_ai_config capability).';

CREATE TRIGGER ai_feature_overrides_updated_at
  BEFORE UPDATE ON ai_feature_overrides FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE ai_feature_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_feature_overrides FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_feature_overrides TO service_role;

-- ────────────────────────────────────────────────────────────
-- SECTION 26: FINANCIAL EVENTS OUTBOX (migration 0033) -- decisions.md T19,
-- accounting-integration readiness layer. mark_invoice_paid's extension
-- lives in SECTION 14 above (it predates this migration); the rest of
-- 0033's atomic-write-plus-outbox functions are here.
-- ────────────────────────────────────────────────────────────

-- Atomic invoice creation: insert + (optional) load status advance + outbox,
-- in one transaction. All pre-checks that decide WHETHER to create (load
-- delivered?, one-invoice-per-load?, invoice number already burned?) stay in
-- app/(app)/invoices/actions.ts exactly as today -- this function only makes
-- the write indivisible and emits the fact.
CREATE OR REPLACE FUNCTION create_invoice_command(
  p_load_id             BIGINT,
  p_customer_org_id     BIGINT,
  p_invoice_number      TEXT,
  p_amount              NUMERIC,
  p_due_date            DATE,
  p_payment_method      TEXT,
  p_factoring_company   TEXT,
  p_advance_load_status BOOLEAN,
  p_correlation_id      TEXT,
  p_idempotency_key     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   BIGINT;
  v_actor    UUID;
  v_invoice  RECORD;
  v_existing BIGINT;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF my_role() NOT IN ('owner','solo','finance') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, invoice_number INTO v_invoice
      FROM invoices WHERE load_id = p_load_id AND carrier_org_id = v_org_id;
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number);
  END IF;

  BEGIN
    INSERT INTO invoices (
      carrier_org_id, customer_org_id, load_id, invoice_number, amount, status,
      due_date, payment_method, factoring_company
    ) VALUES (
      v_org_id, p_customer_org_id, p_load_id, p_invoice_number, p_amount, 'draft',
      p_due_date, p_payment_method, p_factoring_company
    )
    RETURNING id, invoice_number INTO v_invoice;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'INVOICE_EXISTS' USING ERRCODE = '23505';
  END;

  IF p_advance_load_status THEN
    UPDATE loads SET status = 'invoiced'
     WHERE id = p_load_id AND carrier_org_id = v_org_id AND status = 'delivered';
  END IF;

  -- No currency key here: the org's currency is resolved once at export
  -- read time from organizations.currency (financial-event-query-
  -- repository.ts), not stamped per-event -- a per-event value would just
  -- be one more place for it to drift from the source of truth.
  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES (
    'InvoiceCreated', 'Invoice', v_invoice.id::TEXT, v_org_id,
    jsonb_build_object(
      'invoiceId', v_invoice.id, 'invoiceNumber', v_invoice.invoice_number,
      'loadId', p_load_id, 'amount', p_amount
    ),
    p_correlation_id, p_idempotency_key
  );

  RETURN jsonb_build_object('outcome', 'APPLIED', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number);
END $$;

REVOKE EXECUTE ON FUNCTION create_invoice_command(
  BIGINT, BIGINT, TEXT, NUMERIC, DATE, TEXT, TEXT, BOOLEAN, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_invoice_command(
  BIGINT, BIGINT, TEXT, NUMERIC, DATE, TEXT, TEXT, BOOLEAN, TEXT, TEXT
) TO authenticated;

-- Invoice sent: replaces the plain UPDATE at the end of lib/invoice-actions.ts's
-- sendInvoiceAndMarkSent (the email send itself, which cannot be transactional
-- with a DB write, stays exactly where it is and still runs first -- this
-- function is only called once the send has already succeeded).
CREATE OR REPLACE FUNCTION mark_invoice_sent_command(
  p_invoice_id      BIGINT,
  p_sent_at         TIMESTAMPTZ,
  p_correlation_id  TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   BIGINT;
  v_actor    UUID;
  v_invoice  RECORD;
  v_existing BIGINT;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF my_role() NOT IN ('owner','solo','finance') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, invoice_number, status INTO v_invoice FROM invoices WHERE id = p_invoice_id AND carrier_org_id = v_org_id;
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'invoice_id', p_invoice_id, 'status', v_invoice.status);
  END IF;

  UPDATE invoices SET status = 'sent', sent_at = p_sent_at
   WHERE id = p_invoice_id AND carrier_org_id = v_org_id
  RETURNING id, invoice_number, amount INTO v_invoice;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
  END IF;

  -- `amount` is included here (not just invoiceId/sentAt) so the
  -- financial-events export's amountFor() has a real figure for this event
  -- type -- an accounting sync reading "InvoiceSent, $0" would be actively
  -- wrong, not just incomplete.
  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES (
    'InvoiceSent', 'Invoice', v_invoice.id::TEXT, v_org_id,
    jsonb_build_object('invoiceId', v_invoice.id, 'invoiceNumber', v_invoice.invoice_number, 'amount', v_invoice.amount, 'sentAt', p_sent_at),
    p_correlation_id, p_idempotency_key
  );

  RETURN jsonb_build_object('outcome', 'APPLIED', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number);
END $$;

REVOKE EXECUTE ON FUNCTION mark_invoice_sent_command(BIGINT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_invoice_sent_command(BIGINT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- DRIVER SETTLEMENTS (migration 0033)
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_driver_settlement_command(
  p_driver_id        BIGINT,
  p_pay_method       TEXT,
  p_rate_value       NUMERIC,
  p_gross_revenue    NUMERIC,
  p_net_pay          NUMERIC,
  p_loads_count      INT,
  p_period_start     DATE,
  p_period_end       DATE,
  p_correlation_id   TEXT,
  p_idempotency_key  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id    BIGINT;
  v_actor     UUID;
  v_settlement RECORD;
  v_existing  BIGINT;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF my_role() NOT IN ('owner','solo','finance') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT has_feature('driver_settlements') THEN
    RAISE EXCEPTION 'TIER_UPGRADE_REQUIRED' USING ERRCODE = 'PT402';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, payment_status INTO v_settlement
      FROM driver_settlements
     WHERE carrier_org_id = v_org_id AND driver_id = p_driver_id
       AND period_start = p_period_start AND period_end = p_period_end
     ORDER BY id DESC LIMIT 1;
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'id', v_settlement.id, 'payment_status', v_settlement.payment_status);
  END IF;

  INSERT INTO driver_settlements (
    carrier_org_id, driver_id, pay_method, rate_value, gross_revenue, net_pay,
    loads_count, payment_status, period_start, period_end, pdf_statement_path, created_by
  ) VALUES (
    v_org_id, p_driver_id, p_pay_method, p_rate_value, p_gross_revenue, p_net_pay,
    p_loads_count, 'pending', p_period_start, p_period_end, NULL, v_actor
  )
  RETURNING id, payment_status INTO v_settlement;

  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES (
    'DriverSettlementCreated', 'DriverSettlement', v_settlement.id::TEXT, v_org_id,
    jsonb_build_object(
      'settlementId', v_settlement.id, 'driverId', p_driver_id, 'grossRevenue', p_gross_revenue,
      'netPay', p_net_pay, 'periodStart', p_period_start, 'periodEnd', p_period_end
    ),
    p_correlation_id, p_idempotency_key
  );

  RETURN jsonb_build_object('outcome', 'APPLIED', 'id', v_settlement.id, 'payment_status', v_settlement.payment_status);
END $$;

REVOKE EXECUTE ON FUNCTION create_driver_settlement_command(
  BIGINT, TEXT, NUMERIC, NUMERIC, NUMERIC, INT, DATE, DATE, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_driver_settlement_command(
  BIGINT, TEXT, NUMERIC, NUMERIC, NUMERIC, INT, DATE, DATE, TEXT, TEXT
) TO authenticated;

-- Settlement payment_status change (today only pending -> sent, from the
-- send-ach route's ACH-stub; cleared is future work). Compare-and-swap on
-- p_expected_status, same reasoning as submit_shipment_milestone: the
-- current payment_status IS the version.
CREATE OR REPLACE FUNCTION update_settlement_payment_status_command(
  p_settlement_id    BIGINT,
  p_expected_status  TEXT,
  p_new_status       TEXT,
  p_correlation_id   TEXT,
  p_idempotency_key  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     BIGINT;
  v_actor      UUID;
  v_updated    INTEGER;
  v_settlement RECORD;
  v_existing   BIGINT;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF my_role() NOT IN ('owner','solo','finance') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, payment_status INTO v_settlement FROM driver_settlements WHERE id = p_settlement_id;
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'id', p_settlement_id, 'payment_status', v_settlement.payment_status);
  END IF;

  UPDATE driver_settlements
     SET payment_status = p_new_status
   WHERE id = p_settlement_id AND carrier_org_id = v_org_id AND payment_status = p_expected_status;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    SELECT id, payment_status, carrier_org_id INTO v_settlement FROM driver_settlements WHERE id = p_settlement_id;
    IF NOT FOUND OR v_settlement.carrier_org_id <> v_org_id THEN
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'VERSION_CONFLICT:%', v_settlement.payment_status USING ERRCODE = '40001';
  END IF;

  SELECT id, payment_status, driver_id, net_pay INTO v_settlement FROM driver_settlements WHERE id = p_settlement_id;

  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES (
    'DriverSettlementPaymentStatusChanged', 'DriverSettlement', p_settlement_id::TEXT, v_org_id,
    jsonb_build_object(
      'settlementId', p_settlement_id, 'driverId', v_settlement.driver_id, 'netPay', v_settlement.net_pay,
      'priorStatus', p_expected_status, 'newStatus', p_new_status
    ),
    p_correlation_id, p_idempotency_key
  );

  RETURN jsonb_build_object('outcome', 'APPLIED', 'id', v_settlement.id, 'payment_status', v_settlement.payment_status);
END $$;

REVOKE EXECUTE ON FUNCTION update_settlement_payment_status_command(BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_settlement_payment_status_command(BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- LOAD EXPENSES (migration 0033)
-- ────────────────────────────────────────────────────────────
-- Genuinely new: no write path exists for load_expenses anywhere in the app
-- before this migration (query-only via test fixtures). Built fresh as a v1
-- command, so it gets the atomic write + outbox in its very first version
-- rather than as a later retrofit.
CREATE OR REPLACE FUNCTION record_load_expense_command(
  p_load_id          BIGINT,
  p_expense_type     TEXT,
  p_amount           NUMERIC,
  p_note             TEXT,
  p_correlation_id   TEXT,
  p_idempotency_key  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   BIGINT;
  v_actor    UUID;
  v_expense  RECORD;
  v_existing BIGINT;
  v_load     RECORD;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF my_role() NOT IN ('owner','solo','dispatcher') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT has_feature('load_expenses') THEN
    RAISE EXCEPTION 'TIER_UPGRADE_REQUIRED' USING ERRCODE = 'PT402';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, expense_type, amount INTO v_expense
      FROM load_expenses WHERE load_id = p_load_id AND carrier_org_id = v_org_id
     ORDER BY id DESC LIMIT 1;
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'id', v_expense.id, 'amount', v_expense.amount);
  END IF;

  SELECT id, carrier_org_id INTO v_load FROM loads WHERE id = p_load_id;
  IF NOT FOUND OR v_load.carrier_org_id <> v_org_id THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO load_expenses (carrier_org_id, load_id, expense_type, amount, note, logged_by)
  VALUES (v_org_id, p_load_id, p_expense_type, p_amount, p_note, v_actor)
  RETURNING id, expense_type, amount INTO v_expense;

  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES (
    'LoadExpenseRecorded', 'LoadExpense', v_expense.id::TEXT, v_org_id,
    jsonb_build_object(
      'expenseId', v_expense.id, 'loadId', p_load_id, 'expenseType', v_expense.expense_type, 'amount', v_expense.amount
    ),
    p_correlation_id, p_idempotency_key
  );

  RETURN jsonb_build_object('outcome', 'APPLIED', 'id', v_expense.id, 'amount', v_expense.amount);
END $$;

REVOKE EXECUTE ON FUNCTION record_load_expense_command(BIGINT, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_load_expense_command(BIGINT, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION create_invoice_command IS 'Atomic invoice create + optional load status advance + outbox (T19 readiness layer, migration 0033).';
COMMENT ON FUNCTION mark_invoice_sent_command IS 'Atomic invoice sent status change + outbox (T19 readiness layer, migration 0033). Email send happens before this is called and is not part of the transaction.';
COMMENT ON FUNCTION create_driver_settlement_command IS 'Atomic driver settlement create + outbox (T19 readiness layer, migration 0033).';
COMMENT ON FUNCTION update_settlement_payment_status_command IS 'Atomic CAS settlement payment_status change + outbox (T19 readiness layer, migration 0033).';
COMMENT ON FUNCTION record_load_expense_command IS 'Atomic load expense create + outbox (T19 readiness layer, migration 0033). First write path for load_expenses.';

-- Dispatcher-facing aggregate message inbox (0035): never existed before,
-- legacy or v1 - every prior messages capability is scoped to one load's
-- thread. Deliberately NOT SECURITY DEFINER: runs with the CALLER's own
-- privileges so driver_messages RLS keeps deciding which rows are visible,
-- exactly like every other read in this codebase.
CREATE OR REPLACE FUNCTION list_message_conversations()
RETURNS TABLE(
  load_id BIGINT,
  load_number TEXT,
  last_message_body TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    l.id,
    l.load_number,
    latest.body,
    latest.sent_at,
    (
      SELECT count(*) FROM driver_messages dm2
      WHERE dm2.load_id = l.id AND dm2.read_at IS NULL AND dm2.sender_id <> auth.uid()
    )
  FROM loads l
  JOIN LATERAL (
    SELECT dm.body, dm.sent_at
    FROM driver_messages dm
    WHERE dm.load_id = l.id
    ORDER BY dm.sent_at DESC
    LIMIT 1
  ) latest ON true
  ORDER BY latest.sent_at DESC;
$$;

-- ────────────────────────────────────────────────────────────
-- Platform-admin "Debug / Error Log" viewer (migration 0038)
-- ────────────────────────────────────────────────────────────
-- lib/observability.ts's logError() already does the real work of error
-- tracking (structured console.error JSON line + Sentry.captureException,
-- no-op unless a DSN is configured) -- this table is NOT a second logging
-- pipeline. It's a lightweight, best-effort mirror of the same calls into
-- Postgres so a ShipmentX admin without Sentry access can see "what errored,
-- on which route, for which org/user, recently" without needing a Sentry
-- seat. Full stack traces stay in Sentry only -- this table never stores one
-- (see the `message`/`context` column comments).
--
-- Write path: exclusively logError() itself (lib/observability.ts), via the
-- service-role admin client (lib/supabase/server.ts's createAdminClient(),
-- same client every /api/admin/** route uses per lib/admin-auth.ts), wrapped
-- in its own try/catch so a DB hiccup can never turn a logged error into an
-- unhandled one or block the response. Read path: GET /api/v1/admin/error-log,
-- gated by requireAdminRole() exactly like every other admin route.
CREATE TABLE app_error_log (
  id          BIGSERIAL PRIMARY KEY,
  route       TEXT NOT NULL,
  -- Short, already-serialized message only (serializeError(error).message) --
  -- deliberately NOT the `stack` field serializeError() also produces. Stack
  -- traces are Sentry's job (captureException in the same logError() call);
  -- duplicating them here would be exactly the second logging pipeline this
  -- table is scoped to avoid.
  message     TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'error' CHECK (level = 'error'),
  org_id      BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  request_id  TEXT,
  -- Small, non-sensitive `extra` fields only (e.g. route/status/failureMode-
  -- style context) -- logError()'s insert redacts anything secret/token-
  -- shaped and never a raw request/response body. Not a general-purpose
  -- metadata bag.
  context     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_error_log IS
  'Best-effort mirror of lib/observability.ts logError() calls, for the ShipmentX admin Debug/Error Log viewer (app/(admin)/admin/logs). Not a replacement for Sentry (full stack traces live there only) and has no retention/cleanup job yet -- unbounded growth is a known follow-up, out of scope here.';
COMMENT ON COLUMN app_error_log.message IS 'Short serialized error message only -- never a stack trace (Sentry has that).';
COMMENT ON COLUMN app_error_log.context IS 'Small non-secret extra fields (route/status/failureMode-style) only -- never raw request/response bodies or anything secret/token-shaped.';

CREATE INDEX idx_app_error_log_created_at ON app_error_log(created_at DESC);
CREATE INDEX idx_app_error_log_org_id ON app_error_log(org_id);

-- Server-only, same posture as ai_provider_config (migration 0031) --
-- written exclusively by logError()'s service-role insert and read
-- exclusively by GET /api/v1/admin/error-log's service-role admin client.
-- No authenticated/anon grant at all -- there is no legitimate reason for a
-- tenant session to read or write this table directly.
ALTER TABLE app_error_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_error_log FROM anon, authenticated;
GRANT SELECT, INSERT ON app_error_log TO service_role;
-- SECTION 5's blanket `GRANT ... ON ALL SEQUENCES ... TO authenticated,
-- service_role` (migration 0001) would otherwise leave `authenticated` able
-- to advance this sequence directly; revoke it back off, same as
-- outbox_events_id_seq/change_events_id_seq (migrations 0005/0012).
REVOKE ALL ON SEQUENCE app_error_log_id_seq FROM anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE app_error_log_id_seq TO service_role;
-- ────────────────────────────────────────────────────────────────────────────
-- WEBHOOKS (migration 0037) — org-level outbound webhooks, Settings > Integrations.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE webhooks (
  id                 BIGSERIAL PRIMARY KEY,
  org_id             BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url                TEXT NOT NULL,
  secret             TEXT NOT NULL,
  subscribed_events  TEXT[] NOT NULL DEFAULT '{}',
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX webhooks_org_id_idx ON webhooks(org_id);

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_solo_webhooks_all" ON webhooks FOR ALL USING (
  org_id = my_org_id()
  AND my_role() IN ('owner','solo')
) WITH CHECK (
  org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);
-- Explicit grants (migration 0044/0045, fixing a real 0037 bug -- see 0002_tighten_base_grants.sql
-- for why none is implicit here). service_role gets full CRUD, not just SELECT (0044's original
-- guess): scripts/load-demo-data.mjs also writes straight through the service-role admin client for
-- demo fixtures, same admin-bypass posture this codebase already gives service_role on every other
-- such table (e.g. loads' GRANT ALL).
REVOKE ALL ON webhooks FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhooks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhooks TO service_role;
GRANT USAGE, SELECT ON SEQUENCE webhooks_id_seq TO authenticated, service_role;

CREATE TABLE webhook_deliveries (
  id                  BIGSERIAL PRIMARY KEY,
  webhook_id          BIGINT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  org_id              BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type          TEXT NOT NULL,
  payload             JSONB NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_attempted_at   TIMESTAMPTZ,
  last_response_status INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX webhook_deliveries_webhook_id_idx ON webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX webhook_deliveries_org_id_idx ON webhook_deliveries(org_id);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_solo_webhook_deliveries_select" ON webhook_deliveries FOR SELECT USING (
  org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);
-- Explicit grants (migration 0044, fixing a real 0037 bug -- see webhooks above).
REVOKE ALL ON webhook_deliveries FROM anon;
GRANT SELECT ON webhook_deliveries TO authenticated;
GRANT SELECT, INSERT, UPDATE ON webhook_deliveries TO service_role;
GRANT USAGE, SELECT ON SEQUENCE webhook_deliveries_id_seq TO service_role;

COMMENT ON TABLE webhooks IS 'Org-registered outbound webhook endpoints (Settings > Integrations). First real webhook infra in this codebase.';
COMMENT ON TABLE webhook_deliveries IS 'Delivery attempt log for webhooks — observability + bounded inline retry, no external job queue.';

-- ────────────────────────────────────────────────────────────────────────────
-- TELEMATICS (migration 0042) — real Samsara + Motive integration. Settings >
-- Integrations > Telematics stores per-org vendor credentials;
-- vehicle_locations is the normalized location-ping table any vendor (or the
-- existing loads.last_location_* phone-GPS path) can feed. See migration
-- 0042's header comment for the full rationale.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE telematics_integrations (
  id                        BIGSERIAL PRIMARY KEY,
  carrier_org_id            BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider                  TEXT NOT NULL CHECK (provider IN ('samsara','motive')),
  api_key_encrypted         TEXT,
  webhook_secret_encrypted  TEXT,
  enabled                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                UUID REFERENCES profiles(id) ON DELETE SET NULL,

  CONSTRAINT telematics_integrations_org_provider_unique UNIQUE (carrier_org_id, provider),
  CONSTRAINT telematics_integrations_credential_matches_provider CHECK (
    (provider = 'samsara' AND api_key_encrypted IS NOT NULL AND webhook_secret_encrypted IS NULL)
    OR (provider = 'motive' AND webhook_secret_encrypted IS NOT NULL AND api_key_encrypted IS NULL)
  )
);

CREATE INDEX telematics_integrations_carrier_org_id_idx ON telematics_integrations(carrier_org_id);

CREATE TRIGGER telematics_integrations_updated_at
  BEFORE UPDATE ON telematics_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE telematics_integrations IS 'One row per (carrier_org_id, provider) telematics vendor credential (Settings > Integrations > Telematics). Credentials are app-layer AES-256-GCM encrypted (lib/crypto/secrets.ts), same posture as ai_provider_config -- never plaintext at rest, never returned by any GET route.';

ALTER TABLE telematics_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_solo_telematics_integrations_all" ON telematics_integrations FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
) WITH CHECK (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);
-- Explicit grants (migration 0043, fixing a real 0042 bug -- RLS policies alone are not reachable
-- without a base table grant; see 0002_tighten_base_grants.sql for why none is implicit here).
REVOKE ALL ON telematics_integrations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON telematics_integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON telematics_integrations TO service_role;
GRANT USAGE, SELECT ON SEQUENCE telematics_integrations_id_seq TO authenticated, service_role;

CREATE TABLE vehicle_locations (
  id              BIGSERIAL PRIMARY KEY,
  vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  carrier_org_id  BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('samsara','motive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX vehicle_locations_vehicle_id_recorded_at_idx ON vehicle_locations(vehicle_id, recorded_at DESC);
CREATE INDEX vehicle_locations_carrier_org_id_idx ON vehicle_locations(carrier_org_id);

COMMENT ON TABLE vehicle_locations IS 'Normalized telematics location pings, vehicle-scoped (not load-scoped) -- lets an idle vehicle with no active load still show a live position on the dispatch map.';

ALTER TABLE vehicle_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_vehicle_locations_select" ON vehicle_locations FOR SELECT USING (
  carrier_org_id = my_org_id()
);
-- Explicit grants (migration 0043, fixing a real 0042 bug -- see telematics_integrations above).
-- authenticated only ever SELECTs (matches the SELECT-only policy above); all writes come from the
-- service-role admin client (Motive webhook receiver, Samsara poller), never UPDATE/DELETE.
REVOKE ALL ON vehicle_locations FROM anon;
GRANT SELECT ON vehicle_locations TO authenticated;
GRANT SELECT, INSERT ON vehicle_locations TO service_role;
GRANT USAGE, SELECT ON SEQUENCE vehicle_locations_id_seq TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- LOADBOARD (Migration 0052) — DAT load-board integration, Phase 1 (posting
-- only, mocked client). Settings > Integrations > Load Board stores the org's
-- DAT API key; loadboard_postings is an append-only audit trail of loads
-- posted, and the "already posted" check for the load-detail "Post to DAT"
-- button. Capability (loadboard_posting) is owner/solo/dispatcher, unlike
-- telematics_integrations' owner/solo-only subscription_management gate — see
-- Migration 0052's header comment for why.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE loadboard_integrations (
  id                  BIGSERIAL PRIMARY KEY,
  carrier_org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('dat')),
  api_key_encrypted   TEXT,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,

  CONSTRAINT loadboard_integrations_org_provider_unique UNIQUE (carrier_org_id, provider)
);

CREATE INDEX loadboard_integrations_carrier_org_id_idx ON loadboard_integrations(carrier_org_id);

CREATE TRIGGER loadboard_integrations_updated_at
  BEFORE UPDATE ON loadboard_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE loadboard_integrations IS 'One row per (carrier_org_id, provider) load-board vendor credential (Settings > Integrations > Load Board). Credential is app-layer AES-256-GCM encrypted (lib/crypto/secrets.ts) -- never plaintext at rest, never returned by any GET route. Phase 1: DAT only, posting-only.';

ALTER TABLE loadboard_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_loadboard_integrations_all" ON loadboard_integrations FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo','dispatcher')
) WITH CHECK (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo','dispatcher')
);
REVOKE ALL ON loadboard_integrations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON loadboard_integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON loadboard_integrations TO service_role;
GRANT USAGE, SELECT ON SEQUENCE loadboard_integrations_id_seq TO authenticated, service_role;

CREATE TABLE loadboard_postings (
  id                    BIGSERIAL PRIMARY KEY,
  load_id               BIGINT NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  carrier_org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL CHECK (provider IN ('dat')),
  external_posting_id   TEXT NOT NULL,
  posted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by             UUID REFERENCES profiles(id) ON DELETE SET NULL,

  CONSTRAINT loadboard_postings_load_provider_unique UNIQUE (load_id, provider)
);

CREATE INDEX loadboard_postings_load_id_idx ON loadboard_postings(load_id);
CREATE INDEX loadboard_postings_carrier_org_id_idx ON loadboard_postings(carrier_org_id);

COMMENT ON TABLE loadboard_postings IS 'Append-only audit trail of loads posted to an external load board (DAT, Phase 1). One row per successful post -- external_posting_id is whatever id the vendor returned (mocked in Phase 1 by MockDatClient).';

ALTER TABLE loadboard_postings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_loadboard_postings_select" ON loadboard_postings FOR SELECT USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo','dispatcher')
);
CREATE POLICY "carrier_loadboard_postings_insert" ON loadboard_postings FOR INSERT WITH CHECK (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo','dispatcher')
);
REVOKE ALL ON loadboard_postings FROM anon;
GRANT SELECT, INSERT ON loadboard_postings TO authenticated;
GRANT SELECT, INSERT ON loadboard_postings TO service_role;
GRANT USAGE, SELECT ON SEQUENCE loadboard_postings_id_seq TO authenticated, service_role;

-- Tenant guard (migration 0053, fixing forward a real 0052 gap -- RLS validates the row being
-- written, not what its FKs point at; see 0019's enforce_load_reference_tenancy() for the same
-- pattern): carrier_org_id on a loadboard_postings row must actually match the referenced load's own
-- carrier_org_id, not just the caller's session org.
CREATE OR REPLACE FUNCTION enforce_loadboard_posting_tenancy() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.load_id IS DISTINCT FROM OLD.load_id OR NEW.carrier_org_id IS DISTINCT FROM OLD.carrier_org_id)
     AND NOT EXISTS (SELECT 1 FROM loads WHERE id = NEW.load_id AND carrier_org_id = NEW.carrier_org_id) THEN
    RAISE EXCEPTION 'load does not belong to this carrier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER loadboard_postings_tenancy BEFORE INSERT OR UPDATE ON loadboard_postings
  FOR EACH ROW EXECUTE FUNCTION enforce_loadboard_posting_tenancy();

-- ── Realtime publication (migration 0041) ────────────────────────────────
-- loads/driver_messages Postgres Changes subscriptions (dispatch map,
-- driver chat) only actually deliver events once their table is in this
-- publication -- see migration 0041's header comment for how this was
-- found missing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE loads;
ALTER PUBLICATION supabase_realtime ADD TABLE driver_messages;
-- vehicle_locations (migration 0042) -- idle-truck telematics pins on the dispatch map.
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_locations;

-- ── Demo-only subscription payment ledger + multi-customer load orders (0047) ──
ALTER TABLE billing_events
  ADD COLUMN payment_reference TEXT UNIQUE,
  ADD COLUMN plan_code TEXT,
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN is_simulated BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION demo_change_plan(
  p_org_id BIGINT,
  p_tier TEXT,
  p_payment_reference TEXT
)
RETURNS TABLE(tier TEXT, amount NUMERIC, currency TEXT, event_id BIGINT, event_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing billing_events%ROWTYPE;
  v_current_tier TEXT;
  v_amount NUMERIC(10,2);
  v_event_id BIGINT;
BEGIN
  IF p_org_id IS NULL OR p_tier IS NULL OR p_payment_reference IS NULL OR length(p_payment_reference) > 200 THEN
    RAISE EXCEPTION 'Invalid plan-change request';
  END IF;
  -- Lock the carrier row first so same-key retries serialize cleanly.
  SELECT cd.tier INTO v_current_tier FROM carrier_details cd WHERE cd.org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Carrier billing profile not found'; END IF;
  SELECT * INTO v_existing FROM billing_events WHERE payment_reference = p_payment_reference;
  IF FOUND THEN
    IF v_existing.org_id <> p_org_id OR v_existing.plan_code <> p_tier OR NOT v_existing.is_simulated THEN
      RAISE EXCEPTION 'Payment reference was already used for a different request';
    END IF;
    RETURN QUERY SELECT p_tier, v_existing.amount, v_existing.currency, v_existing.id, COALESCE(v_existing.status, 'simulated_succeeded');
    RETURN;
  END IF;
  SELECT monthly_price INTO v_amount FROM tiers WHERE code = p_tier;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown plan'; END IF;
  IF v_current_tier = p_tier THEN
    RETURN QUERY SELECT p_tier, 0::NUMERIC, 'USD'::TEXT, NULL::BIGINT, 'no_change'::TEXT;
    RETURN;
  END IF;
  UPDATE carrier_details SET tier = p_tier, billing_status = 'active', trial_ends_at = NULL WHERE org_id = p_org_id;
  INSERT INTO billing_events(org_id, event_type, amount, currency, status, is_simulated, plan_code, payment_reference)
    VALUES (p_org_id, 'demo.subscription.payment_succeeded', v_amount, 'USD', 'simulated_succeeded', TRUE, p_tier, p_payment_reference)
    RETURNING id INTO v_event_id;
  RETURN QUERY SELECT p_tier, v_amount, 'USD'::TEXT, v_event_id, 'simulated_succeeded'::TEXT;
END;
$$;
REVOKE ALL ON FUNCTION demo_change_plan(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION demo_change_plan(BIGINT, TEXT, TEXT) TO service_role;

-- Migration 0049: carrier-controlled, customer-safe exception updates on token tracking pages.
ALTER TABLE exception_events
  ADD COLUMN customer_visible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN customer_message TEXT;
ALTER TABLE exception_events
  ADD CONSTRAINT exception_events_customer_message_length
  CHECK (customer_message IS NULL OR char_length(customer_message) BETWEEN 1 AND 280);

CREATE OR REPLACE FUNCTION set_tracking_exception_visibility(
  p_exception_id BIGINT, p_visible BOOLEAN, p_customer_message TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org_id BIGINT := my_org_id();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF my_role() NOT IN ('owner','solo','dispatcher') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_visible IS NULL OR (p_visible AND (p_customer_message IS NULL OR char_length(btrim(p_customer_message)) NOT BETWEEN 1 AND 280)) THEN
    RAISE EXCEPTION 'VALIDATION: customer message must contain 1 to 280 characters' USING ERRCODE = 'PT400';
  END IF;
  UPDATE exception_events e
     SET customer_visible = p_visible,
         customer_message = CASE WHEN p_visible THEN btrim(p_customer_message) ELSE NULL END
    FROM loads l
   WHERE e.id = p_exception_id AND e.carrier_org_id = v_org_id AND e.entity_type = 'load'
     AND l.id = e.entity_id AND l.carrier_org_id = v_org_id AND l.tracking_token IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404'; END IF;
  RETURN p_visible;
END $$;
REVOKE ALL ON FUNCTION set_tracking_exception_visibility(BIGINT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_tracking_exception_visibility(BIGINT, BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION get_public_tracking_exceptions(p_token TEXT)
RETURNS TABLE(customer_message TEXT, severity TEXT, occurred_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT e.customer_message, e.severity, e.occurred_at
    FROM exception_events e
    JOIN loads l ON l.id = e.entity_id AND l.carrier_org_id = e.carrier_org_id
   WHERE l.tracking_token = p_token AND e.entity_type = 'load' AND e.customer_visible AND e.customer_message IS NOT NULL
   ORDER BY e.occurred_at DESC LIMIT 20;
$$;
REVOKE ALL ON FUNCTION get_public_tracking_exceptions(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_tracking_exceptions(TEXT) TO anon, authenticated;

CREATE TABLE load_orders (
  id BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  load_id BIGINT NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  customer_org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  customer_reference TEXT,
  commodity TEXT,
  weight_lbs INT CHECK (weight_lbs IS NULL OR weight_lbs > 0),
  pickup_address TEXT,
  pickup_city TEXT,
  pickup_state TEXT,
  pickup_date DATE,
  delivery_address TEXT,
  delivery_city TEXT,
  delivery_state TEXT,
  delivery_date DATE,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','dispatched','picked_up','in_transit','delivered','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (carrier_org_id, order_number)
);
CREATE INDEX load_orders_load_idx ON load_orders(load_id);
CREATE INDEX load_orders_customer_idx ON load_orders(customer_org_id, load_id);
ALTER TABLE load_orders ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON load_orders TO authenticated;
GRANT ALL ON load_orders TO service_role;
GRANT USAGE, SELECT ON SEQUENCE load_orders_id_seq TO authenticated, service_role;
CREATE POLICY carrier_load_orders_select ON load_orders FOR SELECT TO authenticated USING (
  carrier_org_id = my_org_id() AND (
    my_role() IN ('owner','solo','dispatcher','finance')
    OR (my_role() = 'driver' AND EXISTS (
      SELECT 1 FROM loads l JOIN drivers d ON d.id = l.driver_id
      WHERE l.id = load_orders.load_id AND d.profile_id = auth.uid()
    ))
  )
);
CREATE POLICY carrier_load_orders_insert ON load_orders FOR INSERT TO authenticated WITH CHECK (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')
  AND EXISTS (SELECT 1 FROM loads l WHERE l.id = load_orders.load_id AND l.carrier_org_id = load_orders.carrier_org_id)
  AND EXISTS (SELECT 1 FROM customer_details cd WHERE cd.org_id = load_orders.customer_org_id AND cd.carrier_org_id = load_orders.carrier_org_id)
);
CREATE POLICY carrier_load_orders_update ON load_orders FOR UPDATE TO authenticated
  USING (carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher'))
  WITH CHECK (
    carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')
    AND EXISTS (SELECT 1 FROM loads l WHERE l.id = load_orders.load_id AND l.carrier_org_id = load_orders.carrier_org_id)
    AND EXISTS (SELECT 1 FROM customer_details cd WHERE cd.org_id = load_orders.customer_org_id AND cd.carrier_org_id = load_orders.carrier_org_id)
  );
CREATE POLICY customer_own_load_orders_select ON load_orders FOR SELECT TO authenticated USING (
  customer_org_id = my_org_id() AND my_role() IN ('customer_admin','customer_viewer')
);
CREATE TRIGGER load_orders_updated_at BEFORE UPDATE ON load_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Migration 0050: order-charge allocation, per-customer invoices, and invoice line allocations.
ALTER TABLE load_orders ADD COLUMN billable_amount NUMERIC(10,2);
ALTER TABLE load_orders ADD CONSTRAINT load_orders_billable_amount_nonnegative CHECK (billable_amount IS NULL OR billable_amount >= 0);
WITH ranked AS (
  SELECT o.id, o.load_id, COALESCE(l.rate, 0)::NUMERIC(10,2) AS load_rate,
         row_number() OVER (PARTITION BY o.load_id ORDER BY o.id) AS row_num,
         count(*) OVER (PARTITION BY o.load_id) AS row_count,
         sum(COALESCE(o.weight_lbs, 0)) OVER (PARTITION BY o.load_id) AS total_weight,
         COALESCE(o.weight_lbs, 0) AS weight_lbs
    FROM load_orders o JOIN loads l ON l.id = o.load_id WHERE o.billable_amount IS NULL
), shares AS (
  SELECT r.*, CASE WHEN total_weight > 0 THEN weight_lbs::NUMERIC / total_weight ELSE 1::NUMERIC / row_count END AS share FROM ranked r
), rounded AS (
  SELECT s.*, CASE WHEN row_num < row_count THEN round(load_rate * share, 2) ELSE NULL END AS rounded_share FROM shares s
), allocated AS (
  SELECT r.*, COALESCE(sum(rounded_share) OVER (PARTITION BY load_id ORDER BY row_num ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior_amount FROM rounded r
)
UPDATE load_orders o SET billable_amount = CASE WHEN a.row_num = a.row_count THEN round(a.load_rate - a.prior_amount, 2) ELSE a.rounded_share END FROM allocated a WHERE o.id = a.id;
DROP INDEX invoices_load_unique;
UPDATE invoices i SET customer_org_id = l.customer_org_id
  FROM loads l
 WHERE i.load_id = l.id AND i.carrier_org_id = l.carrier_org_id
   AND i.customer_org_id IS NULL AND l.customer_org_id IS NOT NULL;
CREATE UNIQUE INDEX invoices_load_customer_unique ON invoices(load_id, customer_org_id) WHERE load_id IS NOT NULL AND customer_org_id IS NOT NULL;
CREATE UNIQUE INDEX invoices_load_legacy_unique ON invoices(load_id) WHERE load_id IS NOT NULL AND customer_org_id IS NULL;
CREATE TABLE invoice_order_allocations (
  id BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  load_order_id BIGINT NOT NULL REFERENCES load_orders(id) ON DELETE RESTRICT,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(load_order_id), UNIQUE(invoice_id, load_order_id)
);
CREATE INDEX invoice_order_allocations_invoice_idx ON invoice_order_allocations(invoice_id);
ALTER TABLE invoice_order_allocations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON invoice_order_allocations TO authenticated;
GRANT ALL ON invoice_order_allocations TO service_role;
GRANT USAGE, SELECT ON SEQUENCE invoice_order_allocations_id_seq TO authenticated, service_role;
CREATE POLICY carrier_invoice_order_allocations_select ON invoice_order_allocations FOR SELECT TO authenticated USING (carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','finance'));
INSERT INTO invoice_order_allocations(carrier_org_id, invoice_id, load_order_id, amount)
SELECT i.carrier_org_id, i.id, o.id, o.billable_amount FROM invoices i
JOIN load_orders o ON o.load_id = i.load_id AND o.carrier_org_id = i.carrier_org_id AND o.customer_org_id = i.customer_org_id
WHERE i.load_id IS NOT NULL AND o.billable_amount IS NOT NULL ON CONFLICT (load_order_id) DO NOTHING;

CREATE OR REPLACE FUNCTION prevent_order_changes_after_invoicing()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_load_id BIGINT := COALESCE(NEW.load_id, OLD.load_id);
BEGIN
  IF pg_trigger_depth() <= 1 AND EXISTS (SELECT 1 FROM invoices WHERE load_id = v_load_id)
     AND (TG_OP = 'INSERT' OR TG_OP = 'DELETE' OR OLD.load_id IS DISTINCT FROM NEW.load_id
          OR OLD.customer_org_id IS DISTINCT FROM NEW.customer_org_id OR OLD.billable_amount IS DISTINCT FROM NEW.billable_amount) THEN
    RAISE EXCEPTION 'ORDER_LOCKED_AFTER_INVOICE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER load_orders_lock_after_invoice BEFORE INSERT OR UPDATE OR DELETE ON load_orders FOR EACH ROW EXECUTE FUNCTION prevent_order_changes_after_invoicing();

CREATE OR REPLACE FUNCTION set_load_order_billable_amount(p_order_id BIGINT, p_amount NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org_id BIGINT := my_org_id(); v_rate NUMERIC; v_load_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF my_role() NOT IN ('owner','solo','finance') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_amount IS NOT NULL AND (p_amount < 0 OR round(p_amount, 2) <> p_amount) THEN RAISE EXCEPTION 'VALIDATION: invalid order amount' USING ERRCODE = 'PT400'; END IF;
  SELECT o.load_id, l.rate INTO v_load_id, v_rate FROM load_orders o JOIN loads l ON l.id = o.load_id WHERE o.id = p_order_id AND o.carrier_org_id = v_org_id FOR UPDATE OF l;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404'; END IF;
  IF p_amount IS NOT NULL AND p_amount > COALESCE(v_rate, 0) THEN RAISE EXCEPTION 'VALIDATION: order amount exceeds load rate' USING ERRCODE = 'PT400'; END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE load_id = v_load_id AND carrier_org_id = v_org_id) THEN RAISE EXCEPTION 'ORDER_LOCKED_AFTER_INVOICE' USING ERRCODE = 'PT409'; END IF;
  UPDATE load_orders SET billable_amount = p_amount WHERE id = p_order_id AND carrier_org_id = v_org_id;
  RETURN p_amount;
END $$;
REVOKE ALL ON FUNCTION set_load_order_billable_amount(BIGINT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_load_order_billable_amount(BIGINT, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION create_load_invoices_command(
  p_load_id BIGINT, p_invoice_rows JSONB, p_due_date DATE, p_payment_method TEXT,
  p_factoring_company TEXT, p_advance_load_status BOOLEAN, p_correlation_id TEXT, p_idempotency_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id BIGINT := my_org_id(); v_actor UUID := auth.uid(); v_load loads%ROWTYPE;
  v_existing BIGINT; v_order_count BIGINT; v_allocation_total NUMERIC(10,2); v_unallocated BIGINT;
  v_expected_count BIGINT; v_input_count BIGINT; v_row RECORD; v_invoice RECORD; v_result JSONB;
BEGIN
  IF v_actor IS NULL OR v_org_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF my_role() NOT IN ('owner','solo','finance') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_payment_method NOT IN ('stripe','factoring','other') OR jsonb_typeof(p_invoice_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'VALIDATION: invalid invoice rows or payment method' USING ERRCODE = 'PT400'; END IF;
  SELECT * INTO v_load FROM loads WHERE id = p_load_id AND carrier_org_id = v_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404'; END IF;
  IF v_load.status NOT IN ('delivered','invoiced') THEN RAISE EXCEPTION 'LOAD_NOT_DELIVERED' USING ERRCODE = 'PT400'; END IF;
  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('invoice_id', id, 'invoice_number', invoice_number) ORDER BY customer_org_id), '[]'::JSONB)
      INTO v_result FROM invoices WHERE load_id = p_load_id AND carrier_org_id = v_org_id;
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'invoices', v_result);
  END IF;
  SELECT count(*), sum(billable_amount), count(*) FILTER (WHERE billable_amount IS NULL)
    INTO v_order_count, v_allocation_total, v_unallocated FROM load_orders WHERE carrier_org_id = v_org_id AND load_id = p_load_id;
  IF v_order_count > 0 THEN
    IF v_unallocated > 0 OR round(COALESCE(v_allocation_total, 0), 2) <> round(COALESCE(v_load.rate, 0), 2) THEN RAISE EXCEPTION 'ORDER_ALLOCATION_MISMATCH' USING ERRCODE = 'PT400'; END IF;
    SELECT count(*) INTO v_expected_count FROM (
      SELECT o.customer_org_id FROM load_orders o WHERE o.carrier_org_id = v_org_id AND o.load_id = p_load_id
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.load_id = p_load_id AND i.carrier_org_id = v_org_id AND i.customer_org_id = o.customer_org_id)
      GROUP BY o.customer_org_id
    ) expected;
    SELECT count(*) INTO v_input_count FROM jsonb_to_recordset(p_invoice_rows) AS r(customer_org_id BIGINT, invoice_number TEXT, amount NUMERIC);
    IF v_input_count <> v_expected_count THEN RAISE EXCEPTION 'ORDER_INVOICE_SET_MISMATCH' USING ERRCODE = 'PT400'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_invoice_rows) AS r(customer_org_id BIGINT, invoice_number TEXT, amount NUMERIC)
       GROUP BY r.customer_org_id HAVING count(*) <> 1 OR min(r.invoice_number) IS NULL OR min(r.amount) IS NULL OR min(r.amount) < 0) THEN
      RAISE EXCEPTION 'VALIDATION: invalid invoice row' USING ERRCODE = 'PT400';
    END IF;
    IF EXISTS (
      SELECT 1 FROM (SELECT o.customer_org_id, round(sum(o.billable_amount), 2) AS expected_amount FROM load_orders o
        WHERE o.carrier_org_id = v_org_id AND o.load_id = p_load_id GROUP BY o.customer_org_id) expected
      JOIN jsonb_to_recordset(p_invoice_rows) AS r(customer_org_id BIGINT, invoice_number TEXT, amount NUMERIC)
        ON r.customer_org_id = expected.customer_org_id WHERE round(r.amount, 2) <> expected.expected_amount
    ) THEN RAISE EXCEPTION 'ORDER_CUSTOMER_AMOUNT_MISMATCH' USING ERRCODE = 'PT400'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_invoice_rows) AS r(customer_org_id BIGINT, invoice_number TEXT, amount NUMERIC)
        WHERE NOT EXISTS (SELECT 1 FROM load_orders o WHERE o.carrier_org_id = v_org_id AND o.load_id = p_load_id AND o.customer_org_id = r.customer_org_id)) THEN
      RAISE EXCEPTION 'ORDER_INVOICE_SET_MISMATCH' USING ERRCODE = 'PT400';
    END IF;
  ELSE
    v_input_count := jsonb_array_length(p_invoice_rows);
    IF v_input_count <> 1 THEN RAISE EXCEPTION 'ORDER_INVOICE_SET_MISMATCH' USING ERRCODE = 'PT400'; END IF;
    SELECT * INTO v_row FROM jsonb_to_recordset(p_invoice_rows) AS r(customer_org_id BIGINT, invoice_number TEXT, amount NUMERIC) LIMIT 1;
    IF v_row.customer_org_id IS DISTINCT FROM v_load.customer_org_id OR v_row.amount IS NULL OR v_row.amount < 0
       OR round(v_row.amount, 2) <> round(COALESCE(v_load.rate, 0), 2) THEN RAISE EXCEPTION 'ORDER_CUSTOMER_AMOUNT_MISMATCH' USING ERRCODE = 'PT400'; END IF;
  END IF;
  FOR v_row IN SELECT * FROM jsonb_to_recordset(p_invoice_rows) AS r(customer_org_id BIGINT, invoice_number TEXT, amount NUMERIC) ORDER BY customer_org_id NULLS FIRST LOOP
    BEGIN
      INSERT INTO invoices(carrier_org_id, customer_org_id, load_id, invoice_number, amount, status, due_date, payment_method, factoring_company)
      VALUES (v_org_id, v_row.customer_org_id, p_load_id, v_row.invoice_number, v_row.amount, 'draft', p_due_date, p_payment_method, p_factoring_company)
      RETURNING id, invoice_number INTO v_invoice;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'INVOICE_EXISTS' USING ERRCODE = '23505'; END;
    IF v_order_count > 0 THEN
      INSERT INTO invoice_order_allocations(carrier_org_id, invoice_id, load_order_id, amount)
      SELECT v_org_id, v_invoice.id, o.id, o.billable_amount FROM load_orders o
       WHERE o.carrier_org_id = v_org_id AND o.load_id = p_load_id AND o.customer_org_id = v_row.customer_org_id;
    END IF;
    INSERT INTO outbox_events(event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
    VALUES ('InvoiceCreated', 'Invoice', v_invoice.id::TEXT, v_org_id,
      jsonb_build_object('invoiceId', v_invoice.id, 'invoiceNumber', v_invoice.invoice_number, 'loadId', p_load_id, 'amount', v_row.amount, 'customerOrgId', v_row.customer_org_id),
      p_correlation_id, p_idempotency_key || ':' || COALESCE(v_row.customer_org_id::TEXT, 'unassigned'));
  END LOOP;
  IF p_advance_load_status AND v_load.status = 'delivered' THEN UPDATE loads SET status = 'invoiced' WHERE id = p_load_id AND carrier_org_id = v_org_id AND status = 'delivered'; END IF;
  INSERT INTO outbox_events(event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES ('InvoiceBatchCreated', 'Load', p_load_id::TEXT, v_org_id, jsonb_build_object('loadId', p_load_id, 'invoiceCount', v_input_count), p_correlation_id, p_idempotency_key);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('invoice_id', id, 'invoice_number', invoice_number) ORDER BY customer_org_id), '[]'::JSONB)
    INTO v_result FROM invoices WHERE load_id = p_load_id AND carrier_org_id = v_org_id;
  RETURN jsonb_build_object('outcome', 'APPLIED', 'invoices', v_result);
END $$;
REVOKE ALL ON FUNCTION create_load_invoices_command(BIGINT, JSONB, DATE, TEXT, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_load_invoices_command(BIGINT, JSONB, DATE, TEXT, TEXT, BOOLEAN, TEXT, TEXT) TO authenticated;
CREATE OR REPLACE FUNCTION create_invoice_command(
  p_load_id BIGINT, p_customer_org_id BIGINT, p_invoice_number TEXT, p_amount NUMERIC,
  p_due_date DATE, p_payment_method TEXT, p_factoring_company TEXT, p_advance_load_status BOOLEAN,
  p_correlation_id TEXT, p_idempotency_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB;
BEGIN
  v_result := create_load_invoices_command(p_load_id,
    jsonb_build_array(jsonb_build_object('customer_org_id', p_customer_org_id, 'invoice_number', p_invoice_number, 'amount', p_amount)),
    p_due_date, p_payment_method, p_factoring_company, p_advance_load_status, p_correlation_id, p_idempotency_key);
  RETURN jsonb_build_object('outcome', v_result->>'outcome', 'invoice_id', v_result #>> '{invoices,0,invoice_id}',
                            'invoice_number', v_result #>> '{invoices,0,invoice_number}');
END $$;
REVOKE EXECUTE ON FUNCTION create_invoice_command(BIGINT, BIGINT, TEXT, NUMERIC, DATE, TEXT, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_invoice_command(BIGINT, BIGINT, TEXT, NUMERIC, DATE, TEXT, TEXT, BOOLEAN, TEXT, TEXT) TO authenticated;
COMMENT ON TABLE invoice_order_allocations IS 'Immutable per-customer order charges captured when carrier invoices are created.';

-- ════════════════════════════════════════════════════════════
-- Admin portfolio analytics, tenant write audit, and carrier onboarding
-- (migrations 0056–0058)
-- ════════════════════════════════════════════════════════════
-- ShipmentX portfolio analytics: current operational metrics with explicit
-- 30-day vs previous-30-day load activity and tier/fleet-size cohorts.
-- This does not pretend to be product event analytics; no event snapshotting
-- is available yet. Access is restricted to the server's service-role client.

CREATE INDEX idx_loads_created_at_carrier ON loads(created_at, carrier_org_id);
CREATE INDEX idx_invoices_created_at_carrier ON invoices(created_at, carrier_org_id);
CREATE INDEX idx_support_tickets_platform_queue ON support_tickets(queue, status, carrier_org_id);

CREATE OR REPLACE FUNCTION admin_carrier_portfolio_analytics(
  p_search TEXT DEFAULT NULL,
  p_tier TEXT DEFAULT NULL,
  p_fleet_band TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 0,
  p_page_size INTEGER DEFAULT 50
)
RETURNS TABLE (
  org_id BIGINT,
  org_name TEXT,
  created_at TIMESTAMPTZ,
  tier TEXT,
  billing_status TEXT,
  fleet_band TEXT,
  active_users BIGINT,
  active_vehicles BIGINT,
  active_drivers BIGINT,
  customer_accounts BIGINT,
  loads_last_30d BIGINT,
  loads_previous_30d BIGINT,
  loads_per_active_vehicle NUMERIC,
  invoices_last_30d BIGINT,
  open_support_tickets BIGINT,
  cohort_carriers BIGINT,
  cohort_median_loads_per_vehicle NUMERIC,
  total_carriers BIGINT,
  active_billing_carriers BIGINT,
  trialing_carriers BIGINT,
  past_due_carriers BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH carrier_base AS (
    SELECT o.id, o.name, o.created_at,
           COALESCE(cd.tier, 'starter') AS tier,
           COALESCE(cd.billing_status, 'trialing') AS billing_status
    FROM organizations o
    LEFT JOIN carrier_details cd ON cd.org_id = o.id
    WHERE o.type = 'carrier'
  ),
  users AS (
    SELECT p.org_id, count(*)::BIGINT AS active_users
    FROM profiles p
    WHERE p.is_active = true
    GROUP BY p.org_id
  ),
  vehicles AS (
    SELECT v.carrier_org_id AS org_id, count(*)::BIGINT AS active_vehicles
    FROM vehicles v
    WHERE v.is_active = true AND v.status = 'active'
    GROUP BY v.carrier_org_id
  ),
  drivers AS (
    SELECT d.carrier_org_id AS org_id, count(*)::BIGINT AS active_drivers
    FROM drivers d
    WHERE d.is_active = true AND d.invite_status = 'accepted'
    GROUP BY d.carrier_org_id
  ),
  customers AS (
    SELECT cd.carrier_org_id AS org_id, count(*)::BIGINT AS customer_accounts
    FROM customer_details cd
    GROUP BY cd.carrier_org_id
  ),
  load_activity AS (
    SELECT l.carrier_org_id AS org_id,
      count(*) FILTER (WHERE l.created_at >= now() - interval '30 days')::BIGINT AS loads_last_30d,
      count(*) FILTER (WHERE l.created_at >= now() - interval '60 days'
                        AND l.created_at < now() - interval '30 days')::BIGINT AS loads_previous_30d
    FROM loads l
    WHERE l.created_at >= now() - interval '60 days'
    GROUP BY l.carrier_org_id
  ),
  invoice_activity AS (
    SELECT i.carrier_org_id AS org_id, count(*)::BIGINT AS invoices_last_30d
    FROM invoices i
    WHERE i.created_at >= now() - interval '30 days'
    GROUP BY i.carrier_org_id
  ),
  tickets AS (
    SELECT st.carrier_org_id AS org_id, count(*)::BIGINT AS open_support_tickets
    FROM support_tickets st
    WHERE st.queue = 'carrieros_support' AND st.status = 'open'
    GROUP BY st.carrier_org_id
  ),
  enriched AS (
    SELECT b.id AS org_id, b.name AS org_name, b.created_at, b.tier, b.billing_status,
      COALESCE(u.active_users, 0)::BIGINT AS active_users,
      COALESCE(v.active_vehicles, 0)::BIGINT AS active_vehicles,
      COALESCE(d.active_drivers, 0)::BIGINT AS active_drivers,
      COALESCE(c.customer_accounts, 0)::BIGINT AS customer_accounts,
      COALESCE(l.loads_last_30d, 0)::BIGINT AS loads_last_30d,
      COALESCE(l.loads_previous_30d, 0)::BIGINT AS loads_previous_30d,
      COALESCE(i.invoices_last_30d, 0)::BIGINT AS invoices_last_30d,
      COALESCE(t.open_support_tickets, 0)::BIGINT AS open_support_tickets,
      CASE
        WHEN COALESCE(v.active_vehicles, 0) = 0 THEN 'no_active_vehicles'
        WHEN v.active_vehicles = 1 THEN '1_vehicle'
        WHEN v.active_vehicles <= 5 THEN '2_5_vehicles'
        WHEN v.active_vehicles <= 20 THEN '6_20_vehicles'
        ELSE '21_plus_vehicles'
      END AS fleet_band,
      CASE WHEN COALESCE(v.active_vehicles, 0) > 0
        THEN round(COALESCE(l.loads_last_30d, 0)::NUMERIC / v.active_vehicles, 2)
        ELSE NULL
      END AS loads_per_active_vehicle
    FROM carrier_base b
    LEFT JOIN users u ON u.org_id = b.id
    LEFT JOIN vehicles v ON v.org_id = b.id
    LEFT JOIN drivers d ON d.org_id = b.id
    LEFT JOIN customers c ON c.org_id = b.id
    LEFT JOIN load_activity l ON l.org_id = b.id
    LEFT JOIN invoice_activity i ON i.org_id = b.id
    LEFT JOIN tickets t ON t.org_id = b.id
  ),
  filtered AS (
    SELECT e.* FROM enriched e
    WHERE (p_search IS NULL OR e.org_name ILIKE '%' || p_search || '%')
      AND (p_tier IS NULL OR e.tier = p_tier)
      AND (p_fleet_band IS NULL OR e.fleet_band = p_fleet_band)
  ),
  cohort_filtered AS (
    SELECT e.* FROM enriched e
    WHERE (p_tier IS NULL OR e.tier = p_tier)
      AND (p_fleet_band IS NULL OR e.fleet_band = p_fleet_band)
  ),
  cohort AS (
    SELECT cf.tier, cf.fleet_band, count(*)::BIGINT AS cohort_carriers,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY cf.loads_per_active_vehicle)::NUMERIC AS cohort_median
    FROM cohort_filtered cf
    WHERE cf.loads_per_active_vehicle IS NOT NULL
    GROUP BY cf.tier, cf.fleet_band
  ),
  totals AS (
    SELECT count(*)::BIGINT AS total_carriers,
      count(*) FILTER (WHERE billing_status = 'active')::BIGINT AS active_billing_carriers,
      count(*) FILTER (WHERE billing_status = 'trialing')::BIGINT AS trialing_carriers,
      count(*) FILTER (WHERE billing_status = 'past_due')::BIGINT AS past_due_carriers
    FROM filtered
  )
  SELECT f.org_id, f.org_name, f.created_at, f.tier, f.billing_status, f.fleet_band,
    f.active_users, f.active_vehicles, f.active_drivers, f.customer_accounts,
    f.loads_last_30d, f.loads_previous_30d, f.loads_per_active_vehicle,
    f.invoices_last_30d, f.open_support_tickets,
    COALESCE(c.cohort_carriers, 0), c.cohort_median,
    totals.total_carriers, totals.active_billing_carriers, totals.trialing_carriers, totals.past_due_carriers
  FROM filtered f
  LEFT JOIN cohort c ON c.tier = f.tier AND c.fleet_band = f.fleet_band
  CROSS JOIN totals
  ORDER BY f.created_at DESC NULLS LAST, f.org_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100)
  OFFSET LEAST(GREATEST(COALESCE(p_page, 0), 0), 10000) * LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);
$$;

REVOKE ALL ON FUNCTION admin_carrier_portfolio_analytics(TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_carrier_portfolio_analytics(TEXT, TEXT, TEXT, INTEGER, INTEGER) TO service_role;
-- Append-only, low-sensitivity write activity for support/security investigation.
-- Store action + record identity only (never row payloads, message bodies, or secrets).
CREATE TABLE tenant_activity_events (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenant_activity_actor_time ON tenant_activity_events(org_id, actor_user_id, occurred_at DESC);
CREATE INDEX idx_tenant_activity_record_time ON tenant_activity_events(org_id, aggregate_type, aggregate_id, occurred_at DESC);
ALTER TABLE tenant_activity_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tenant_activity_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON tenant_activity_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE tenant_activity_events_id_seq TO service_role;
COMMENT ON TABLE tenant_activity_events IS
  'Append-only, payload-free audit of writes to selected tenant records. Does not record reads, failed requests, or auth session/IP/device history.';

CREATE OR REPLACE FUNCTION capture_tenant_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row JSONB := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_org BIGINT := NULLIF(v_row ->> TG_ARGV[1], '')::BIGINT;
  v_id TEXT := NULLIF(v_row ->> 'id', '');
BEGIN
  -- Child rows can be deleted as part of an organization cascade. At that
  -- point the parent is no longer visible, so recording an event would violate
  -- tenant_activity_events.org_id's FK and abort the parent deletion.
  IF v_org IS NOT NULL AND EXISTS (SELECT 1 FROM organizations WHERE id = v_org) THEN
    INSERT INTO tenant_activity_events(org_id, actor_user_id, action, aggregate_type, aggregate_id, operation)
    VALUES (v_org, auth.uid(), lower(TG_ARGV[0]) || '.' || lower(TG_OP), TG_ARGV[0], v_id, TG_OP);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION capture_load_event_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_load_id BIGINT := CASE WHEN TG_OP = 'DELETE' THEN OLD.load_id ELSE NEW.load_id END;
  v_event_id BIGINT := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  v_org BIGINT;
BEGIN
  SELECT carrier_org_id INTO v_org FROM loads WHERE id = v_load_id;
  IF v_org IS NOT NULL THEN
    INSERT INTO tenant_activity_events(org_id, actor_user_id, action, aggregate_type, aggregate_id, operation)
    VALUES (v_org, auth.uid(), 'load_event.' || lower(TG_OP), 'load_event', v_event_id::TEXT, TG_OP);
  END IF;
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION capture_tenant_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION capture_load_event_activity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tenant_activity_loads AFTER INSERT OR UPDATE OR DELETE ON loads
  FOR EACH ROW EXECUTE FUNCTION capture_tenant_activity('load', 'carrier_org_id');
CREATE TRIGGER tenant_activity_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION capture_tenant_activity('invoice', 'carrier_org_id');
CREATE TRIGGER tenant_activity_vehicles AFTER INSERT OR UPDATE OR DELETE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION capture_tenant_activity('vehicle', 'carrier_org_id');
CREATE TRIGGER tenant_activity_drivers AFTER INSERT OR UPDATE OR DELETE ON drivers
  FOR EACH ROW EXECUTE FUNCTION capture_tenant_activity('driver', 'carrier_org_id');
CREATE TRIGGER tenant_activity_profiles AFTER INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION capture_tenant_activity('profile', 'org_id');
CREATE TRIGGER tenant_activity_customers AFTER INSERT OR UPDATE OR DELETE ON customer_details
  FOR EACH ROW EXECUTE FUNCTION capture_tenant_activity('customer_account', 'carrier_org_id');
CREATE TRIGGER tenant_activity_documents AFTER INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION capture_tenant_activity('document', 'carrier_org_id');
CREATE TRIGGER tenant_activity_exceptions AFTER INSERT OR UPDATE OR DELETE ON exception_events
  FOR EACH ROW EXECUTE FUNCTION capture_tenant_activity('exception', 'carrier_org_id');
CREATE TRIGGER tenant_activity_support_tickets AFTER INSERT OR UPDATE OR DELETE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION capture_tenant_activity('support_ticket', 'carrier_org_id');
CREATE TRIGGER tenant_activity_support_messages AFTER INSERT OR UPDATE OR DELETE ON support_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION capture_tenant_activity('support_message', 'carrier_org_id');
CREATE TRIGGER tenant_activity_load_events AFTER INSERT OR UPDATE OR DELETE ON load_events
  FOR EACH ROW EXECUTE FUNCTION capture_load_event_activity();
CREATE TABLE admin_carrier_onboarding (
  org_id BIGINT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  contact_name TEXT NOT NULL CHECK (char_length(trim(contact_name)) BETWEEN 1 AND 120),
  contact_email TEXT NOT NULL CHECK (char_length(trim(contact_email)) BETWEEN 3 AND 254),
  stage TEXT NOT NULL DEFAULT 'intake' CHECK (stage IN ('intake','setup','training','launch_ready','live','blocked')),
  next_action TEXT,
  next_follow_up_at TIMESTAMPTZ,
  blocker_note TEXT,
  owner_invite_sent_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_carrier_onboarding_stage_followup ON admin_carrier_onboarding(stage, next_follow_up_at);
CREATE TRIGGER admin_carrier_onboarding_updated_at
  BEFORE UPDATE ON admin_carrier_onboarding FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE admin_carrier_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_carrier_onboarding FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON admin_carrier_onboarding TO service_role;

CREATE OR REPLACE FUNCTION admin_create_carrier_onboarding(
  p_company_name TEXT,
  p_contact_name TEXT,
  p_contact_email TEXT,
  p_tier TEXT,
  p_country TEXT,
  p_created_by UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id BIGINT;
  v_currency TEXT;
BEGIN
  IF char_length(trim(p_company_name)) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'Company name must be between 2 and 160 characters';
  END IF;
  IF char_length(trim(p_contact_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Contact name must be between 1 and 120 characters';
  END IF;
  IF p_contact_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'A valid contact email is required';
  END IF;
  IF p_tier IS NULL OR p_tier NOT IN ('starter','growth','pro','enterprise') THEN
    RAISE EXCEPTION 'Invalid carrier plan';
  END IF;
  IF p_country IS NULL OR p_country NOT IN ('US','CA','MX') THEN
    RAISE EXCEPTION 'Invalid country';
  END IF;

  v_currency := CASE p_country WHEN 'CA' THEN 'CAD' WHEN 'MX' THEN 'MXN' ELSE 'USD' END;
  INSERT INTO organizations(type, name, email, country, currency)
    VALUES ('carrier', trim(p_company_name), lower(trim(p_contact_email)), p_country, v_currency)
    RETURNING id INTO v_org_id;
  INSERT INTO carrier_details(org_id, tier, billing_status)
    VALUES (v_org_id, p_tier, 'trialing');
  INSERT INTO admin_carrier_onboarding(org_id, contact_name, contact_email, created_by)
    VALUES (v_org_id, trim(p_contact_name), lower(trim(p_contact_email)), p_created_by);
  INSERT INTO admin_events(org_id, admin_id, event_type, metadata)
    VALUES (v_org_id, p_created_by, 'admin.carrier_onboarding_started', jsonb_build_object('tier', p_tier, 'country', p_country));
  RETURN v_org_id;
END $$;

REVOKE ALL ON FUNCTION admin_create_carrier_onboarding(TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_create_carrier_onboarding(TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;
