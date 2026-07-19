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
  uom_system TEXT DEFAULT 'imperial' CHECK (uom_system IN ('imperial','metric'))
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
  preferred_language TEXT DEFAULT 'en' CHECK (preferred_language IN ('en','es','pa','ur')),
  timezone           TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- SECTION 3: CARRIER ENTITIES
-- ────────────────────────────────────────────────────────────

CREATE TABLE trucks (
  id             BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  truck_number   TEXT,
  nickname       TEXT NOT NULL,
  year           INT,
  make           TEXT,
  model          TEXT,
  vin            TEXT,
  license_plate  TEXT,
  license_state  TEXT,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE drivers (
  id                         BIGSERIAL PRIMARY KEY,
  carrier_org_id             BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id                 UUID NOT NULL REFERENCES profiles(id),
  driver_number              TEXT,
  default_truck_id           BIGINT REFERENCES trucks(id),
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
  truck_id          BIGINT REFERENCES trucks(id),
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
    'draft','scheduled','dispatched','picked_up','in_transit','delivered','invoiced','paid'
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
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- SECTION 4: COMPLIANCE & MAINTENANCE
-- ────────────────────────────────────────────────────────────

CREATE TABLE dvir_inspections (
  id             BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT REFERENCES organizations(id),
  truck_id       BIGINT REFERENCES trucks(id),
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
  truck_id       BIGINT REFERENCES trucks(id) ON DELETE CASCADE,
  carrier_org_id BIGINT REFERENCES organizations(id),
  service_type   TEXT NOT NULL,
  service_date   DATE NOT NULL,
  odometer       INT,
  cost           NUMERIC(10,2),
  shop_name      TEXT,
  notes          TEXT,
  logged_by      UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE maintenance_reminders (
  id                BIGSERIAL PRIMARY KEY,
  truck_id          BIGINT REFERENCES trucks(id) ON DELETE CASCADE,
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

CREATE TABLE truck_documents (
  id             BIGSERIAL PRIMARY KEY,
  truck_id       BIGINT REFERENCES trucks(id) ON DELETE CASCADE,
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

-- ────────────────────────────────────────────────────────────
-- SECTION 5: SEQUENCES (atomic, race-safe entity number generation)
-- ────────────────────────────────────────────────────────────

CREATE TABLE org_sequences (
  org_id   BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  entity   TEXT NOT NULL,
  last_val BIGINT DEFAULT 0,
  PRIMARY KEY (org_id, entity)
);

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

-- ────────────────────────────────────────────────────────────
-- SECTION 6: DRIVER-SAFE VIEW
-- ────────────────────────────────────────────────────────────

CREATE VIEW loads_driver_view AS
SELECT
  id, load_number, carrier_org_id, customer_org_id, customer_name_raw,
  driver_id, truck_id,
  pickup_address, pickup_city, pickup_state, pickup_zip, pickup_lat, pickup_lng,
  delivery_address, delivery_city, delivery_state, delivery_zip, delivery_lat, delivery_lng,
  total_miles, pickup_date, pickup_time, delivery_date, delivery_time,
  commodity, weight_lbs,
  -- rate intentionally excluded
  status, intake_method,
  tracking_token, last_location_lat, last_location_lng, last_location_at,
  created_at, updated_at
FROM loads;

-- ────────────────────────────────────────────────────────────
-- SECTION 7: INDEXES
-- ────────────────────────────────────────────────────────────

CREATE INDEX idx_orgs_type              ON organizations(type);
CREATE INDEX idx_customer_details_carrier ON customer_details(carrier_org_id);
CREATE INDEX idx_profiles_org           ON profiles(org_id);
CREATE INDEX idx_trucks_carrier         ON trucks(carrier_org_id);
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
CREATE INDEX idx_dvir_truck             ON dvir_inspections(truck_id);
CREATE INDEX idx_dvir_driver            ON dvir_inspections(driver_id);
CREATE INDEX idx_service_truck          ON service_logs(truck_id);
CREATE INDEX idx_truck_docs_truck       ON truck_documents(truck_id);
CREATE INDEX idx_org_docs               ON org_documents(org_id);

CREATE UNIQUE INDEX idx_customer_number ON customer_details(carrier_org_id, customer_number) WHERE customer_number IS NOT NULL;
CREATE UNIQUE INDEX idx_driver_number   ON drivers(carrier_org_id, driver_number)            WHERE driver_number   IS NOT NULL;
CREATE UNIQUE INDEX idx_truck_number    ON trucks(carrier_org_id, truck_number)              WHERE truck_number    IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- SECTION 8: ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

-- ORGANIZATIONS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_member_select" ON organizations FOR SELECT USING (
  id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR id IN (SELECT carrier_org_id FROM customer_details WHERE org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()))
);
CREATE POLICY "owner_solo_org_update" ON organizations FOR UPDATE USING (
  id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- CARRIER DETAILS
ALTER TABLE carrier_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_details_select" ON carrier_details FOR SELECT USING (
  org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "owner_solo_carrier_update" ON carrier_details FOR UPDATE USING (
  org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- CUSTOMER DETAILS
ALTER TABLE customer_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_customer_select" ON customer_details FOR SELECT USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "carrier_customer_write" ON customer_details FOR ALL USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo','dispatcher')
);

-- PROFILES
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "same_org_profiles_select" ON profiles FOR SELECT USING (
  org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR org_id IN (SELECT org_id FROM customer_details WHERE carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()))
);
CREATE POLICY "own_profile_update" ON profiles FOR UPDATE USING (id = auth.uid());
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
CREATE POLICY "dispatcher_loads_update" ON loads FOR UPDATE USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'dispatcher'
) WITH CHECK (true);
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
CREATE POLICY "public_tracking_select" ON loads FOR SELECT TO anon
  USING (tracking_token IS NOT NULL);

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
CREATE POLICY "driver_own_record" ON drivers FOR SELECT USING (profile_id = auth.uid());
CREATE POLICY "driver_own_record_update" ON drivers FOR UPDATE USING (profile_id = auth.uid()) WITH CHECK (true);

-- TRUCKS
ALTER TABLE trucks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_trucks_select" ON trucks FOR SELECT USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "owner_solo_trucks_all" ON trucks FOR ALL USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- DOCUMENTS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_docs_select" ON documents FOR SELECT USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "driver_pod_insert" ON documents FOR INSERT WITH CHECK (uploaded_by = auth.uid());
CREATE POLICY "owner_solo_docs_all" ON documents FOR ALL USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- LOAD EVENTS
ALTER TABLE load_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_load_events_select" ON load_events FOR SELECT USING (
  load_id IN (SELECT id FROM loads WHERE carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()))
);
CREATE POLICY "authenticated_load_events_insert" ON load_events FOR INSERT WITH CHECK (created_by = auth.uid());

-- DVIR INSPECTIONS
ALTER TABLE dvir_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_dvir_select" ON dvir_inspections FOR SELECT USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "driver_dvir_insert" ON dvir_inspections FOR INSERT WITH CHECK (
  driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid())
);
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

-- TRUCK DOCUMENTS
ALTER TABLE truck_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_truck_docs_select" ON truck_documents FOR SELECT USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "owner_solo_truck_docs_all" ON truck_documents FOR ALL USING (
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
