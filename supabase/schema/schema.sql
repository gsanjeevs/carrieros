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
  default_language TEXT NOT NULL DEFAULT 'en' CHECK (default_language IN ('en','es','pa','ur')),
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
  grace_period_until  TIMESTAMPTZ
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
  'Role -> capability gating, single-sourced for web + mobile via scripts/gen-role-capabilities.mjs. UI/navigation gating only, not a security boundary -- see migration 0009 header comment.';

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
INSERT INTO languages (code, label, native_name, flag_emoji, display_order) VALUES
  ('en','English','English','🇺🇸',1),
  ('es','Spanish','Español','🇲🇽',2),
  ('pa','Punjabi','ਪੰਜਾਬੀ','🇮🇳',3),
  ('ur','Urdu','اردو','🇵🇰',4);

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
  display_order INT NOT NULL
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
  preferred_language TEXT CHECK (preferred_language IN ('en','es','pa','ur')),
  timezone           TEXT,
  -- Per-user overrides of carrier_details defaults (decisions.md L2 — personal
  -- prefs follow the user). NULL uom_system means "inherit from carrier_details".
  uom_system         TEXT CHECK (uom_system IN ('imperial','metric')),
  date_format        TEXT DEFAULT 'MM/DD/YYYY' CHECK (date_format IN ('MM/DD/YYYY','DD/MM/YYYY','YYYY-MM-DD')),
  time_format        TEXT DEFAULT '12h' CHECK (time_format IN ('12h','24h')),
  -- Light/dark appearance (2026-07-26). NOT NULL with a 'system' default
  -- rather than nullable-means-inherit like uom_system above: there is no
  -- org-level theme to inherit from, and 'system' already expresses "follow
  -- the device" explicitly. Mobile mirrors this into AsyncStorage so the
  -- pre-login screens (welcome/login/signup) and cold start can theme
  -- themselves before any profile row is readable.
  theme_preference   TEXT NOT NULL DEFAULT 'system' CHECK (theme_preference IN ('light','dark','system')),
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
CREATE POLICY "auth_user_create_carrier_org" ON organizations
  FOR INSERT WITH CHECK (type = 'carrier' AND auth.uid() IS NOT NULL);
-- Covers: (a) reading your own org, (b) if you're a customer-portal user,
-- reading your carrier's org.
CREATE POLICY "org_member_select" ON organizations FOR SELECT USING (
  id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR id IN (SELECT carrier_org_id FROM customer_details WHERE org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()))
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
  id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- CARRIER DETAILS
ALTER TABLE carrier_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_user_create_carrier_details" ON carrier_details
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "carrier_details_select" ON carrier_details FOR SELECT USING (
  org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "owner_solo_carrier_update" ON carrier_details FOR UPDATE USING (
  org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- CUSTOMER DETAILS
-- NOTE: uses my_org_id()/my_role() (not a direct profiles subquery) because
-- profiles' own SELECT policy below queries customer_details — a direct
-- subquery cycle here would recurse into that policy and back again.
ALTER TABLE customer_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_customer_select" ON customer_details FOR SELECT USING (
  carrier_org_id = my_org_id() OR org_id = my_org_id()
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
CREATE POLICY "own_profile_insert" ON profiles FOR INSERT WITH CHECK (id = auth.uid());

-- LOADS
ALTER TABLE loads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_solo_loads_all" ON loads FOR ALL USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);
CREATE POLICY "dispatcher_loads_select" ON loads FOR SELECT USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'dispatcher'
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
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'finance'
);
CREATE POLICY "driver_own_loads_select" ON loads FOR SELECT USING (
  driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid())
);
CREATE POLICY "driver_loads_update_status" ON loads FOR UPDATE USING (
  driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid())
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
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo','finance')
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
  carrier_org_id = my_org_id() AND driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid())
);
CREATE POLICY "owner_solo_dispatcher_fuel_stops_all" ON fuel_stops FOR ALL TO authenticated USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')
);

ALTER TABLE load_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_load_expenses_select" ON load_expenses FOR SELECT TO authenticated USING (
  carrier_org_id = my_org_id()
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
  carrier_org_id = my_org_id() AND driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid())
);
CREATE POLICY "owner_solo_dispatcher_ifta_crossings_all" ON ifta_state_crossings FOR ALL TO authenticated USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')
);

-- DRIVER MESSAGES (Phase 7D, 2026-07-21) -- Finance gets ZERO access per
-- BR-2/FR-119, not even SELECT -- no policy below grants finance anything.
ALTER TABLE driver_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "driver_own_thread_messages" ON driver_messages FOR ALL TO authenticated USING (
  load_id IN (SELECT id FROM loads WHERE driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid()))
) WITH CHECK (
  load_id IN (SELECT id FROM loads WHERE driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid()))
);
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
  driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid())
);
CREATE POLICY "owner_solo_finance_settlements_all" ON driver_settlements FOR ALL TO authenticated USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','finance')
);

ALTER TABLE settlement_deductions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "same_org_settlement_deductions_select" ON settlement_deductions FOR SELECT TO authenticated USING (
  settlement_id IN (
    SELECT ds.id FROM driver_settlements ds
    WHERE ds.carrier_org_id = my_org_id()
       OR ds.driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid())
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
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);
CREATE POLICY "dispatcher_drivers_select" ON drivers FOR SELECT USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'dispatcher'
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
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "owner_solo_vehicles_all" ON vehicles FOR ALL USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- DOCUMENTS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_docs_select" ON documents FOR SELECT USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
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
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- LOAD EVENTS
ALTER TABLE load_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_load_events_select" ON load_events FOR SELECT USING (
  load_id IN (SELECT id FROM loads WHERE carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()))
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
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "driver_dvir_insert" ON dvir_inspections FOR INSERT WITH CHECK (
  driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid())
);

-- Added 2026-07-20 (audit finding 6): driver had INSERT only, so a two-step
-- submit (insert inspection, then attach signature/odometer) was impossible —
-- the update failed silently as UPDATE 0.
CREATE POLICY "driver_dvir_modify" ON dvir_inspections FOR UPDATE TO authenticated
  USING (driver_id = (SELECT d.id FROM drivers d WHERE d.profile_id = auth.uid()))
  WITH CHECK (driver_id = (SELECT d.id FROM drivers d WHERE d.profile_id = auth.uid()));
CREATE POLICY "owner_solo_dvir_all" ON dvir_inspections FOR ALL USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- DVIR DEFECTS
ALTER TABLE dvir_defects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dvir_defects_select" ON dvir_defects FOR SELECT USING (
  inspection_id IN (SELECT id FROM dvir_inspections WHERE carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()))
);
CREATE POLICY "driver_dvir_defects_insert" ON dvir_defects FOR INSERT WITH CHECK (
  inspection_id IN (SELECT id FROM dvir_inspections WHERE driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid()))
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
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "owner_solo_service_logs_all" ON service_logs FOR ALL USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- MAINTENANCE REMINDERS
ALTER TABLE maintenance_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_reminders_select" ON maintenance_reminders FOR SELECT USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "owner_solo_reminders_all" ON maintenance_reminders FOR ALL USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- VEHICLE DOCUMENTS (renamed from TRUCK DOCUMENTS, 2026-07-21, decisions.md S8)
ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_vehicle_docs_select" ON vehicle_documents FOR SELECT USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "owner_solo_vehicle_docs_all" ON vehicle_documents FOR ALL USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- ORG DOCUMENTS
ALTER TABLE org_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_solo_org_docs_all" ON org_documents FOR ALL USING (
  org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);
CREATE POLICY "finance_org_docs_select" ON org_documents FOR SELECT USING (
  org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'finance'
);

-- DRIVER DOCUMENTS (new, 2026-07-21, decisions.md S10 — mirrors
-- vehicle_documents' shape exactly, scoped via a direct profiles subquery)
ALTER TABLE driver_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_driver_docs_select" ON driver_documents FOR SELECT USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "owner_solo_driver_docs_all" ON driver_documents FOR ALL USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
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
    AND entity_id IN (SELECT id FROM loads WHERE driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid()))
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
-- SECTION 14: ATOMIC MARK-INVOICE-PAID (migration 0014)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_invoice_paid(p_invoice_id BIGINT, p_paid_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_load_id BIGINT;
  v_exists  BOOLEAN;
BEGIN
  UPDATE invoices
     SET status = 'paid', paid_at = p_paid_at
   WHERE id = p_invoice_id AND status <> 'paid'
  RETURNING load_id INTO v_load_id;

  IF NOT FOUND THEN
    SELECT EXISTS (SELECT 1 FROM invoices WHERE id = p_invoice_id) INTO v_exists;
    IF NOT v_exists THEN
      -- Missing and not-visible-to-you are the same answer on purpose.
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
    END IF;
    RETURN jsonb_build_object('outcome', 'ALREADY_PAID', 'invoice_id', p_invoice_id);
  END IF;

  IF v_load_id IS NOT NULL THEN
    UPDATE loads SET status = 'paid' WHERE id = v_load_id;
  END IF;

  RETURN jsonb_build_object('outcome', 'APPLIED', 'invoice_id', p_invoice_id, 'load_id', v_load_id);
END $$;

REVOKE EXECUTE ON FUNCTION mark_invoice_paid(BIGINT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_invoice_paid(BIGINT, TIMESTAMPTZ) TO authenticated;

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
