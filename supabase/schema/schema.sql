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
  type       TEXT NOT NULL CHECK (type IN ('carrier','customer')),
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
  -- Carrier's own subscription billing (demo-mode seam — see lib/stripe.ts).
  -- stripe_customer_id NULL means no payment method on file yet; a
  -- 'demo_cus_...' placeholder once the demo "Add Payment Method" flow runs.
  -- Swapping in real Stripe replaces only createStripeCustomer()'s body.
  billing_status      TEXT NOT NULL DEFAULT 'trialing'
                      CHECK (billing_status IN ('trialing','active','past_due','canceled')),
  trial_ends_at       TIMESTAMPTZ DEFAULT (now() + interval '90 days'),
  stripe_customer_id  TEXT,
  card_brand          TEXT,
  card_last4          TEXT
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
  display_order INT NOT NULL
);
INSERT INTO roles (code, label, abbreviation, color_token, display_order) VALUES
  ('owner','Owner','OW','brand-orange',1),
  ('solo','Solo','SO','brand-orange',2),
  ('driver','Driver','DR','success',3),
  ('dispatcher','Dispatcher','DI','info',4),
  ('finance','Finance','FI','purple',5),
  ('customer_admin','Customer Admin','CA','navy-muted',6),
  ('customer_viewer','Customer Viewer','CV','navy-muted',7);

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
  ('customer_health_score','Customer Health Score','growth',3);

-- ────────────────────────────────────────────────────────────
-- SECTION 2: PROFILES — ALL users in the system
-- Carrier users:          org_id → carrier organization, role ∈ {owner,solo,driver,dispatcher,finance}
-- Customer portal users:  org_id → customer organization, role ∈ {customer_admin,customer_viewer}
-- ────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id             BIGINT NOT NULL REFERENCES organizations(id),
  role               TEXT NOT NULL CHECK (role IN (
    'owner','solo','driver','dispatcher','finance',
    'customer_admin','customer_viewer'
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
  -- Driver photo (2026-07-21, decisions.md S10) -- mobile-captured only, web
  -- is display-only (signed URL). Same `documents` bucket path convention.
  avatar_path        TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

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
  status            TEXT DEFAULT 'draft' CHECK (status IN (
    'draft','scheduled','dispatched','picked_up','in_transit','delivered','invoiced','paid','cancelled'
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
  factored_at         TIMESTAMPTZ
);
-- One invoice per load — a double-billed load is the kind of error a carrier
-- only finds out about when the customer complains.
CREATE UNIQUE INDEX invoices_load_unique ON invoices(load_id) WHERE load_id IS NOT NULL;

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
CREATE OR REPLACE FUNCTION my_org_id()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION my_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
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

ALTER TABLE languages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "languages_select" ON languages FOR SELECT TO authenticated USING (true);

ALTER TABLE tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tiers_select" ON tiers FOR SELECT TO authenticated USING (true);

ALTER TABLE features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "features_select" ON features FOR SELECT TO authenticated USING (true);

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

-- PROFILES
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "same_org_profiles_select" ON profiles FOR SELECT USING (
  org_id = my_org_id()
  OR org_id IN (SELECT org_id FROM customer_details WHERE carrier_org_id = my_org_id())
);
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
CREATE POLICY "customer_loads_select" ON loads FOR SELECT USING (
  customer_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('customer_admin','customer_viewer')
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
CREATE POLICY "customer_invoices_select" ON invoices FOR SELECT USING (
  customer_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('customer_admin','customer_viewer')
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
