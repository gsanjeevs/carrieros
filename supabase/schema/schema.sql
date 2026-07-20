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
  uom_system TEXT DEFAULT 'imperial' CHECK (uom_system IN ('imperial','metric')),
  -- Default billing rail for new invoices (decision R1). Per-invoice override
  -- lives on invoices.payment_method.
  default_payment_method TEXT NOT NULL DEFAULT 'other'
                         CHECK (default_payment_method IN ('stripe','factoring','other')),
  factoring_company      TEXT
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
  -- Per-user overrides of carrier_details defaults (decisions.md L2 — personal
  -- prefs follow the user). NULL uom_system means "inherit from carrier_details".
  uom_system         TEXT CHECK (uom_system IN ('imperial','metric')),
  date_format        TEXT DEFAULT 'MM/DD/YYYY' CHECK (date_format IN ('MM/DD/YYYY','DD/MM/YYYY','YYYY-MM-DD')),
  time_format        TEXT DEFAULT '12h' CHECK (time_format IN ('12h','24h')),
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
  invite_status              TEXT DEFAULT 'pending' CHECK (invite_status IN ('pending','accepted','revoked')),
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
-- number/class/state, endorsements, default truck) but not the fields defining
-- their employment or compliance standing.
CREATE POLICY "driver_own_record_update" ON drivers FOR UPDATE TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (
    profile_id = auth.uid()
    AND driver_self_update_allowed(carrier_org_id, cdl_expiry, med_cert_expiry, is_active, driver_number)
  );

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
