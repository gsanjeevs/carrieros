# CarrierOS — Technical Specification

> **AI coding context doc.** Drop this file + `strategy/prd.md` as context when prompting Claude or Codex. Together they are the full source of truth.

**Changelog:**
- Oct 2026 — §5.7 added: the built public developer API (`/api/public/v1/*`) and the separate `carrieros-mcp` repo/service that consumes it. Targeted addition only; the rest of this file has not been re-audited since v3.0 (for current deployment/infrastructure see `architecture/deployment.md` and `architecture/infrastructure-as-code.md`).
- Jul 2026 (v3.0) — **Full refresh to match schema.sql v4.0 and actual implementation**, replacing content that had drifted from reality: §4 schema rewritten around the unified `organizations` model (was still documenting the old `companies` table); §5 API routes rewritten around the dual-auth (`lib/api-auth.ts`) pattern — cookie session (web) OR `Authorization: Bearer` (mobile, added this pass since carrieros-mobile now exists) — plus the `error_code` convention for i18n-safe client-side messages, and the rule that plain RLS-protected CRUD/atomic writes should be a Postgres RPC or direct Supabase call rather than a Next.js route by default (see `create_customer_org`); §6 field names updated (`org_id`/`carrier_org_id`, not `company_id`); §10 rewritten to match carrieros-mobile's actual structure (`src/app/`, `(tabs)` route group, `expo-router/unstable-native-tabs`, an SSR-safe storage adapter for the Supabase client — `expo start --web` renders once in Node before hydrating, and AsyncStorage's web backend crashes on `window` if not guarded); §16 reconciled with the actual auto-derive-from-country/state onboarding flow (no manual timezone/UOM picker, contra what this section previously described) and currency added; §1 Next.js 14 → 16; §2 design tokens corrected to match what's actually implemented. See `docs/decisions.md` for the full rationale behind each of these — this file is kept as the condensed AI-coding-context version, decisions.md is the fuller record including things ruled out and why.
- Jul 2026 (v2.4) — §16 added: Timezone (company default + user override, IANA strings, UTC storage) and UOM (company-level imperial/metric, display-time conversion only); companies.timezone, companies.uom_system, profiles.timezone columns added to §4.1 schema
- Jul 2026 (v2.3) — Architecture change: Capacitor replaced with Expo (React Native) for mobile app; two-app architecture documented (carrieros-mobile/ Expo + carrieros-web/ Next.js); §10 rewritten as Expo Setup; §3 Expo project structure added; §12 build order updated; §14 i18n updated for React Native; next.config.js output:'export' removed
- Jul 2026 (v2.2) — §15 updated: ifta_state_crossings gains `source` column ('gps'|'manual'); GPS completeness check algorithm + odometer fallback trigger documented; RLS updated to allow Driver INSERT/DELETE on their own load's crossing rows for fallback flow
- Jul 2026 (v2.1) — Post-MVP schema section added (Section 15): planned tables for Growth+, Pro, and Enterprise tiers (fuel_stops, ifta_state_crossings, driver_messages, driver_settlements, carrier_profiles, load_board_postings)
- Jul 2026 — 5-role model; driver compliance columns; company_documents, dvir_inspections, service_logs, maintenance_reminders, truck_documents tables; loads_driver_view; dispatcher/finance route groups; RLS for all roles; 'enterprise' tier naming; i18n (Section 14); preferred_language moved to profiles table (all roles)
- Jun 2026 — Initial version; stack, schema, API routes, auth flow for owner/driver roles

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Web app | Next.js 16.2.10 (App Router) | Owner/Finance/Dispatcher desktop; public tracking; onboarding. Deployed on AWS ECS Express Mode (container, see architecture/deployment.md). `middleware.ts` is renamed `proxy.ts` in this version — `export async function proxy(...)`, not `middleware` (decision T1) |
| Styling | Tailwind CSS | Mobile-first; design tokens below |
| Backend | Supabase | Postgres DB + Auth + Storage + Realtime. Schema is `organizations`-centric (v4.0) — see §4 |
| API routes | Next.js `/app/api/` — **only for what genuinely needs a server secret or service-role bypass** (AI extraction, invite email, admin auth API). Plain RLS-protected CRUD and atomic multi-table writes go through Postgres RPCs or direct Supabase calls instead — see §5 | Server-side only |
| Mobile app | Expo (React Native), SDK 57 | carrieros-mobile/ — Driver app + Owner mobile. True native iOS/Android. Expo Router (`src/app/` as root, not `app/`), EAS Build for production, Expo Updates for OTA. See §10 |
| Mobile build | EAS Build + EAS Submit | Production iOS/Android builds; App Store + Play Store submission |
| AI extraction | Anthropic Claude API | claude-haiku-4-5 for cost; called from Next.js API route |
| File storage | Supabase Storage | POD photos, rate cons, truck/org docs, DVIR signatures |
| Email sending | Resend | Invoice emails, invite links, inbound email forwarding webhook |
| Deployment | AWS ECS Express Mode | Containerized (`Dockerfile`, `output: "standalone"`), not serverless — see architecture/deployment.md |

---

## 2. Design Tokens

```css
--navy:   #0f1923;
--orange: #f97316;
--green:  #16a34a;
--teal:   #1abc9c;
--amber:  #d97706;
--red:    #dc2626;
```

Font: Inter. Icons: Material Symbols Outlined (loaded via a Google Fonts link in `app/layout.tsx` — Google Fonts is otherwise unavailable in local dev per `docs/resume.md`).

---

## 3. Project Structure

**As actually implemented** (carrieros-web/, verified against the repo, not aspirational):

```
carrieros-web/
├── app/
│   ├── login/
│   │   ├── page.tsx
│   │   └── actions.ts                     # signInWithEmail, signOut server actions
│   ├── auth/callback/route.ts             # Magic-link + OAuth redirect handler
│   ├── onboarding/page.tsx                # 2-step form → POST /api/onboarding
│   ├── (app)/                             # ALL authenticated roles share this one group —
│   │   │                                  # no separate (owner)/(driver) split. Role-specific
│   │   │                                  # visibility is enforced by proxy.ts's ROLE_ROUTES
│   │   │                                  # table and by what each page queries, not by
│   │   │                                  # separate layouts per role (deviates from the
│   │   │                                  # original plan below this table — simpler in
│   │   │                                  # practice with one role model to route, not two).
│   │   ├── layout.tsx
│   │   ├── dashboard/{layout,page}.tsx
│   │   ├── loads/
│   │   │   ├── page.tsx                   # Load list
│   │   │   ├── new/page.tsx + new/paste/page.tsx + new/review/page.tsx   # Intake flow
│   │   │   └── [load_number]/page.tsx     # Load detail + status timeline + DispatchPanel
│   │   ├── dispatch/page.tsx
│   │   ├── customers/page.tsx
│   │   ├── drivers/page.tsx
│   │   ├── trucks/page.tsx
│   │   ├── team/page.tsx
│   │   ├── finance/page.tsx
│   │   ├── maintenance/page.tsx
│   │   ├── documents/page.tsx
│   │   └── my-loads/page.tsx
│   └── api/                               # Only routes needing a server secret or
│       │                                  # service-role bypass live here — see §5.
│       ├── onboarding/route.ts            # Admin-client bootstrap (org+carrier_details+profile)
│       ├── extract-load/route.ts          # Claude Haiku extraction
│       ├── drivers/invite/route.ts        # Magic-link driver invite (decision R3)
│       ├── loads/route.ts + loads/[id]/route.ts
│       ├── drivers/route.ts               # GET only — creation is drivers/invite
│       ├── trucks/route.ts
│       └── customers/route.ts             # POST delegates to create_customer_org RPC
├── components/
│   ├── Sidebar.tsx
│   ├── DispatchPanel.tsx
│   └── ExtractionReview.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts                      # Browser client (createBrowserClient from @supabase/ssr)
│   │   └── server.ts                      # createClient() (cookie session) + createAdminClient() (service role)
│   ├── api-auth.ts                        # getAuthedContext() — cookie OR Bearer token; apiError() with error_code — see §5
│   └── generate-number.ts                 # next_entity_val RPC wrapper (load/customer/driver/truck/invoice numbers)
├── proxy.ts                                # middleware — auth guard, role routing, onboarding redirect. Exempts /api/* (self-authenticating). Next.js 16 renamed middleware.ts → proxy.ts (decision T1)
├── types/
│   └── supabase.ts                        # Generated (npx supabase gen types typescript --local) — copy into carrieros-mobile too when touched
└── next.config.ts
```

**Not yet built** (planned, from PRD/build order, not present in the repo yet): `messages/*.json` (i18n, next-intl not wired despite `i18n-js` being installed mobile-side), `lib/roles.ts` role-helper module, `track/[token]/page.tsx` public tracking page, `invoices/` pages + `/api/send-invoice`, `import-customers`/`parse-pdf`/`intake-email`/`send-invite`/`dvir-submit` API routes, `compliance/`/`settings/` pages. See `docs/resume.md` for current build-order status.

---

## 4. Database Schema

**Source of truth:** `docs/carrieros-db/schema.sql` (Zoho Drive). This section mirrors it — if the two
ever disagree, schema.sql wins; re-sync this section, don't trust this doc over the file. Full schema
history and the recursion bug that shaped the RLS pattern below: `docs/decisions.md` and `docs/resume.md`.

### 4.1 Core Tables — unified `organizations` model (v4.0)

One `organizations` table holds both carriers (SaaS tenants) and customers (shippers/brokers),
distinguished by `type`. Type-specific fields live in `carrier_details`/`customer_details`. Every
person in the system — carrier staff AND future customer-portal users — has exactly one `profiles`
row (decision S3). All entity PKs are `BIGSERIAL` except `profiles.id`, which is `UUID` because it
references `auth.users(id)` (decision S2). The FK to a carrier is always named `carrier_org_id`
(decision S5) — never `company_id`.

```sql
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
  currency   TEXT DEFAULT 'USD' CHECK (currency IN ('USD','CAD','MXN')),  -- auto-derived from country at onboarding, see §16
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Carrier-only fields (SaaS tenant config)
CREATE TABLE carrier_details (
  org_id     BIGINT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  mc_number  TEXT,
  dot_number TEXT,
  load_email TEXT UNIQUE,
  tier       TEXT DEFAULT 'starter' CHECK (tier IN ('starter','growth','pro','enterprise')),
  timezone   TEXT DEFAULT 'America/Los_Angeles',   -- auto-derived from country+state at onboarding, see §16
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

-- ALL users in the system.
-- Carrier users:         org_id → carrier organization, role ∈ {owner,solo,driver,dispatcher,finance}
-- Customer portal users: org_id → customer organization, role ∈ {customer_admin,customer_viewer} (Phase 2)
-- 'solo' is default at onboarding (decision P3/S-solo); 'owner' only when explicitly chosen.
CREATE TABLE profiles (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id             BIGINT NOT NULL REFERENCES organizations(id),
  role               TEXT NOT NULL CHECK (role IN (
    'owner','solo','driver','dispatcher','finance',
    'customer_admin','customer_viewer'
  )),
  first_name         TEXT,   -- NOT full_name (decision S4) — needed for salutations, sorting
  last_name          TEXT,
  phone              TEXT,
  preferred_language TEXT DEFAULT 'en' CHECK (preferred_language IN ('en','es','pa','ur')),
  timezone           TEXT,   -- NULL = inherit carrier_details.timezone; set = user override (IANA string)
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE trucks (
  id             BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  truck_number   TEXT,          -- e.g. "T-1" — generated via next_entity_val(), see §4.5
  nickname       TEXT NOT NULL, -- e.g. "Big Blue"
  year           INT,
  make           TEXT,
  model          TEXT,
  vin            TEXT,
  license_plate  TEXT,
  license_state  TEXT,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- One row per driver, created atomically with their profile at invite time
-- (POST /api/drivers/invite) — not deferred to first sign-in. See §6.
CREATE TABLE drivers (
  id                         BIGSERIAL PRIMARY KEY,
  carrier_org_id             BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id                 UUID NOT NULL REFERENCES profiles(id),  -- NOT NULL — see §6 invite flow
  driver_number              TEXT,
  invite_status              TEXT DEFAULT 'pending' CHECK (invite_status IN ('pending','accepted','revoked')),
  default_truck_id           BIGINT REFERENCES trucks(id),
  is_active                  BOOLEAN DEFAULT true,

  -- Compliance (driver fills in on /driver/profile after accepting invite)
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

-- Loads
CREATE TABLE loads (
  id                BIGSERIAL PRIMARY KEY,
  carrier_org_id    BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_org_id   BIGINT REFERENCES organizations(id),      -- FK to organizations, type='customer'
  customer_name_raw TEXT,                                      -- fallback if customer not in directory
  load_number       TEXT NOT NULL,                             -- e.g. "L-1" — next_entity_val()
  driver_id         BIGINT REFERENCES drivers(id),
  truck_id          BIGINT REFERENCES trucks(id),

  pickup_address    TEXT, pickup_city TEXT, pickup_state TEXT, pickup_zip TEXT,
  pickup_lat        NUMERIC, pickup_lng NUMERIC,
  delivery_address  TEXT, delivery_city TEXT, delivery_state TEXT, delivery_zip TEXT,
  delivery_lat      NUMERIC, delivery_lng NUMERIC,
  total_miles       NUMERIC(8,1),

  pickup_date       DATE, pickup_time TIME,
  delivery_date     DATE, delivery_time TIME,

  commodity         TEXT,
  weight_lbs        INT,
  rate              NUMERIC(10,2),  -- NEVER exposed to driver role — see loads_driver_view §4.3

  status            TEXT DEFAULT 'draft' CHECK (status IN (
                      'draft','scheduled','dispatched',
                      'picked_up','in_transit','delivered','invoiced','paid'
                    )),

  intake_method     TEXT CHECK (intake_method IN ('email','pdf','paste','manual')),
  raw_intake_text   TEXT,
  extraction_data   JSONB,

  tracking_token    TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,  -- decision R2 — public /track/[token]
  last_location_lat NUMERIC,
  last_location_lng NUMERIC,
  last_location_at  TIMESTAMPTZ,

  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()   -- auto-updated by trigger, see §4.6
);

CREATE TABLE load_events (
  id           BIGSERIAL PRIMARY KEY,
  load_id      BIGINT NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,   -- e.g. 'status_in_transit'
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
  invoice_number  TEXT NOT NULL,     -- e.g. "INV-1" — next_entity_val()
  amount          NUMERIC(10,2) NOT NULL,
  -- payment_method (decision R1 — Stripe + factoring both supported) NOT YET ADDED to schema.sql;
  -- add `payment_method TEXT CHECK (payment_method IN ('stripe','factoring','other'))` before
  -- building the invoice flow.
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue')),
  sent_at         TIMESTAMPTZ,
  due_date        DATE,
  paid_at         TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 4.2 Compliance & Maintenance Tables

```sql
-- DVIR Inspections (pre/post-trip, FMCSA 49 CFR 396.11)
CREATE TABLE dvir_inspections (
  id             BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT REFERENCES organizations(id),
  truck_id       BIGINT REFERENCES trucks(id),
  load_id        BIGINT REFERENCES loads(id),    -- null if standalone
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

-- Fleet-wide documents (COI, MC authority, W-9, etc.) — renamed from
-- company_documents to org_documents in v4.0, matches organizations FK.
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
```

### 4.3 Driver-Safe View (hides rate column)

```sql
-- Used for ALL driver-role load queries, from both web and mobile — rate is
-- structurally excluded, not just hidden in the UI (decision P6/BR-1).
CREATE VIEW loads_driver_view AS
SELECT
  id, load_number, carrier_org_id, customer_org_id, customer_name_raw,
  driver_id, truck_id,
  pickup_address, pickup_city, pickup_state, pickup_zip, pickup_lat, pickup_lng,
  delivery_address, delivery_city, delivery_state, delivery_zip, delivery_lat, delivery_lng,
  total_miles, pickup_date, pickup_time, delivery_date, delivery_time,
  commodity, weight_lbs,
  -- rate intentionally omitted
  status, intake_method,
  tracking_token, last_location_lat, last_location_lng, last_location_at,
  created_at, updated_at
FROM loads;
```

### 4.4 Sequences and RPCs

```sql
-- Atomic, race-safe per-carrier entity numbering (no fixed-width padding —
-- grows naturally: L-1, L-42, L-10523). Callable directly by web or mobile
-- via supabase.rpc('next_entity_val', {...}) — no server secret needed.
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

-- Creates a customer (organizations row, type='customer') + its
-- customer_details row atomically, scoped to the caller's own carrier org.
-- SECURITY DEFINER so the whole thing runs as one transaction regardless of
-- caller role, while still enforcing the org/role check internally.
-- Callable directly via supabase.rpc('create_customer_org', {...}) from web
-- or mobile — no Next.js API layer needed for this write (see §5, decision
-- R3b). This is the pattern to follow for any future atomic multi-table
-- write that doesn't need a server secret: a SECURITY DEFINER RPC using
-- my_org_id()/my_role() (§4.5), not a Next.js route.
CREATE OR REPLACE FUNCTION create_customer_org(
  p_name TEXT, p_phone TEXT DEFAULT NULL, p_email TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_state TEXT DEFAULT NULL,
  p_zip TEXT DEFAULT NULL, p_country TEXT DEFAULT 'US',
  p_contact_name TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL
)
RETURNS TABLE(org_id BIGINT, name TEXT, customer_number TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_org_id  BIGINT := my_org_id();
  v_caller_role    TEXT   := my_role();
  v_new_org_id     BIGINT;
  v_customer_number TEXT;
BEGIN
  IF v_caller_org_id IS NULL THEN RAISE EXCEPTION 'NO_ORGANIZATION'; END IF;
  IF v_caller_role NOT IN ('owner','solo','dispatcher') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN RAISE EXCEPTION 'VALIDATION_ERROR: name is required'; END IF;

  INSERT INTO organizations (type, name, phone, email, address, city, state, zip, country)
  VALUES ('customer', p_name, p_phone, p_email, p_address, p_city, p_state, p_zip, COALESCE(p_country, 'US'))
  RETURNING id INTO v_new_org_id;

  v_customer_number := 'C-' || next_entity_val(v_caller_org_id, 'customer');

  INSERT INTO customer_details (org_id, carrier_org_id, customer_number, contact_name, notes)
  VALUES (v_new_org_id, v_caller_org_id, v_customer_number, p_contact_name, p_notes);

  RETURN QUERY SELECT v_new_org_id, p_name, v_customer_number;
END;
$$;
```

### 4.5 Row Level Security

**`my_org_id()` / `my_role()` helper functions — read this before writing any new policy.**
A policy on `profiles` that subqueries `profiles` itself (or a table whose own policy subqueries
`profiles` back) throws `infinite recursion detected in policy for relation "profiles"` — hit for
real once between `profiles` and `customer_details` (see `docs/resume.md` "Bug found + fixed
2026-07-19"). Fix: these two `SECURITY DEFINER` functions bypass RLS to read `profiles`, breaking
the cycle. **Any policy that needs the caller's org_id/role on a table involved in such a cycle
must use these, not a direct subquery.** `carrier_details`, `loads`, `drivers`, etc. are NOT in a
cycle with `profiles` and can keep the plain subquery form — only `customer_details`↔`profiles`
needs the helpers, but using them everywhere is the safer default.

```sql
CREATE OR REPLACE FUNCTION my_org_id()
RETURNS BIGINT LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION my_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

-- ─── ORGANIZATIONS ──────────────────────────────────────────────────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_user_create_carrier_org" ON organizations
  FOR INSERT WITH CHECK (type = 'carrier' AND auth.uid() IS NOT NULL);
CREATE POLICY "org_member_select" ON organizations FOR SELECT USING (
  id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR id IN (SELECT carrier_org_id FROM customer_details WHERE org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()))
);
-- Reverse direction: a carrier reading its OWN customers' org rows. Without
-- this, GET /api/customers' embedded organizations(...) join silently drops
-- every row — PostgREST embeds are inner joins, so an RLS-blocked embedded
-- row removes the whole outer row, not just the embedded field. (Second
-- real bug found this session — see decisions.md R3b.)
CREATE POLICY "carrier_reads_own_customer_orgs" ON organizations FOR SELECT USING (
  type = 'customer' AND id IN (SELECT org_id FROM customer_details WHERE carrier_org_id = my_org_id())
);
CREATE POLICY "owner_solo_org_update" ON organizations FOR UPDATE USING (
  id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- ─── CARRIER DETAILS ────────────────────────────────────────────────────────
ALTER TABLE carrier_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_user_create_carrier_details" ON carrier_details FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "carrier_details_select" ON carrier_details FOR SELECT USING (
  org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "owner_solo_carrier_update" ON carrier_details FOR UPDATE USING (
  org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- ─── CUSTOMER DETAILS ───────────────────────────────────────────────────────
-- Uses my_org_id()/my_role() (not a direct profiles subquery) — see the
-- recursion note above; this table is the one genuinely in a cycle with profiles.
ALTER TABLE customer_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_customer_select" ON customer_details FOR SELECT USING (
  carrier_org_id = my_org_id() OR org_id = my_org_id()
);
CREATE POLICY "carrier_customer_write" ON customer_details FOR ALL USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')
);

-- ─── PROFILES ───────────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "same_org_profiles_select" ON profiles FOR SELECT USING (
  org_id = my_org_id()
  OR org_id IN (SELECT org_id FROM customer_details WHERE carrier_org_id = my_org_id())
);
CREATE POLICY "own_profile_update" ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "own_profile_insert" ON profiles FOR INSERT WITH CHECK (id = auth.uid());

-- ─── LOADS ──────────────────────────────────────────────────────────────────
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
CREATE POLICY "public_tracking_select" ON loads FOR SELECT TO anon USING (tracking_token IS NOT NULL);

-- ─── INVOICES ───────────────────────────────────────────────────────────────
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing_invoices_all" ON invoices FOR ALL USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo','finance')
);
CREATE POLICY "customer_invoices_select" ON invoices FOR SELECT USING (
  customer_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('customer_admin','customer_viewer')
);
-- Dispatcher: no access to invoices table at all.

-- ─── DRIVERS ────────────────────────────────────────────────────────────────
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

-- ─── TRUCKS ─────────────────────────────────────────────────────────────────
ALTER TABLE trucks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_trucks_select" ON trucks FOR SELECT USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "owner_solo_trucks_all" ON trucks FOR ALL USING (
  carrier_org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('owner','solo')
);

-- ─── DOCUMENTS / LOAD EVENTS / ORG DOCUMENTS / COMPLIANCE — same pattern ────
-- owner/solo get ALL; carrier-scoped SELECT for everyone else in the org;
-- driver/uploader can INSERT their own rows. See schema.sql SECTION 8 for
-- the full, exact policy list per table (documents, load_events,
-- dvir_inspections, dvir_defects, service_logs, maintenance_reminders,
-- truck_documents, org_documents) — not reproduced here to keep this section
-- scannable; the pattern above is representative of all of them.
```

---

## 5. API Routes

### 5.0 The rule: when does something need to be a Next.js route at all?

**Decide this before writing a new route.** Two shapes only (decision R3b):

1. **Needs a server secret or the service-role bypass** (Anthropic key, Resend key, Supabase Admin
   Auth API, or the onboarding bootstrap that runs before the user has an org to satisfy RLS INSERT
   policies) → a Next.js route under `app/api/`.
2. **Plain RLS-protected CRUD, or an atomic multi-table write that doesn't need a secret** → a
   Postgres RPC (`SECURITY DEFINER` if it needs to bypass RLS for its own internal checks, like
   `create_customer_org` in §4.4) or a direct `supabase.from()`/`.rpc()` call. Callable identically
   by web and mobile — **no Next.js layer**, so there's exactly one implementation of the rule, not
   one per client.

Getting this wrong was the actual bug this decision fixed: every route in this section used to
authenticate via cookies only, which silently made every one of them unreachable from
carrieros-mobile (no cookies) — and `POST /api/customers`'s two-table insert had no RLS policy
allowing it at all, so it had never actually worked.

**Auth for shape 1 routes — `lib/api-auth.ts`:**
```typescript
// Every server-secret route starts like this:
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)   // reads Authorization: Bearer <token>
  if (isErrorResponse(ctx)) return ctx           // (mobile) OR the cookie session (web)
  const { supabase, user } = ctx
  // ...
}
```
`getAuthedContext()` checks for an `Authorization: Bearer <token>` header first (what carrieros-mobile
sends — Expo has no cookies, session lives in AsyncStorage) and falls back to the cookie-based
session (`@supabase/ssr`) for web. **`proxy.ts` exempts all of `/api/*` from its own auth guard** —
that guard only reads cookies, so without the exemption every Bearer-token request from mobile would
get redirected to `/login` before the route handler ever ran (this happened; see `docs/resume.md`).

**Error convention — every route returns `error_code`, not just `error`:**
```typescript
{ error_code: 'FORBIDDEN', error: 'Insufficient permissions' }
```
`error` is an English string for logs/devs only — never render it to an end user. `error_code` is a
stable, locale-independent key (`AUTH_REQUIRED`, `NOT_ONBOARDED`, `FORBIDDEN`, `ALREADY_ONBOARDED`,
`VALIDATION_ERROR`, `NOT_FOUND`, `EXTRACTION_FAILED`, `SERVER_ERROR` — full list in `lib/api-auth.ts`)
that each client maps to a localized string via its own `messages/{locale}.json` (next-intl web,
i18n-js mobile). This is required for the four supported languages (§14) — a route that only ever
returns English prose leaves Punjabi/Urdu/Spanish-speaking users staring at raw English on error.

### 5.1 `POST /api/extract-load`

AI extraction from pasted text (email body, SMS, broker portal copy). Requires auth (any
authenticated carrier user — no org/role check needed since the caller hasn't created a load yet).

**Request:** `{ text: string }`

**Response:** flat JSON matching the extraction schema — `customer_name_raw`, `load_number_raw`,
pickup/delivery address+city+state+zip+date+time, `commodity`, `weight_lbs`, `rate`, `total_miles`,
plus a `confidence` object (`pickup`/`delivery`/`rate`/`dates`, each `'high'|'medium'|'low'`).
Model: `claude-haiku-4-5`, called directly via `@anthropic-ai/sdk` — no `lib/extract.ts` indirection.

---

### 5.2 `POST /api/onboarding`

Creates `organizations` (type='carrier') + `carrier_details` + `profiles` atomically, using
`createAdminClient()` (service role — bypasses RLS since the user has no org yet to satisfy the
INSERT policies, decision T3). `timezone`/`uom_system`/`currency` are auto-derived from
`country`+`state`, never asked directly (see §16 — this deviates from what §16 used to describe).
Errors are prefixed `[step1]`/`[step2]`/`[step3]` per which of the three inserts failed, for triage.

---

### 5.3 `POST /api/drivers/invite`

Magic-link driver invite (decision R3). Server-only: uses `createAdminClient()` for the Supabase
Admin Auth API call and to bootstrap `profiles`+`drivers` (invitee has no session to satisfy RLS).

**Request:** `{ email: string, phone?, first_name?, last_name?, default_truck_id? }`

**Logic (all synchronous, at invite time — not deferred to first sign-in):**
1. Caller must be owner/solo (checked via the normal RLS-scoped client, not admin)
2. `admin.auth.admin.inviteUserByEmail(email, { data: { org_id, role: 'driver' }, redirectTo })`
3. Insert `profiles` row for the new `auth.users` id (role='driver') — via admin client
4. `next_entity_val()` for `driver_number`, insert `drivers` row (`invite_status: 'pending'`)

Why synchronous rather than deferred: `drivers.profile_id` is `NOT NULL`, so a `drivers` row cannot
exist before a `profiles` row does. Doing both at invite time (mirroring the onboarding bootstrap
pattern) avoids relaxing that constraint and avoids a second profile-creation code path in
`app/auth/callback/route.ts` — the callback needed no changes as a result. The invitee still must
click the magic link to authenticate; only the DB rows exist ahead of that.

---

### 5.4 `POST /api/customers`

**Request:** `{ name, phone?, email?, address?, city?, state?, zip?, country?, contact_name?, notes? }`

Validates `name` is present, then delegates entirely to the `create_customer_org` RPC (§4.4) — no
direct table writes in the route. `GET` lists via `customer_details` joined to `organizations`, using
the disambiguated embed `organizations!customer_details_org_id_fkey(...)` (`customer_details` has two
FKs to `organizations`, so the bare `organizations(...)` form throws `PGRST201` — ambiguous embed).

---

### 5.5 `POST /api/loads`, `PATCH /api/loads/[id]`, `GET/POST /api/trucks`, `GET /api/drivers`

Plain CRUD, kept as thin Next.js routes for now (web already depends on them) but authenticated via
`lib/api-auth.ts` so they're callable from mobile too. None of these need a server secret — RLS plus
`next_entity_val()` already enforce everything a Next.js layer would otherwise duplicate. New mobile
code should generally call Supabase directly for this kind of write rather than going through these
routes (§5.0) — they're not being removed, just not the model to copy for new work.

---

### 5.6 Not yet built (planned, from PRD)

`POST /api/parse-pdf` (PDF→text, feeds into extract-load), `POST /api/intake-email` (Resend inbound
webhook), `POST /api/send-invoice` (needs `invoices.payment_method` — decision R1, not yet in
schema.sql), `POST /api/import-customers` (CSV/XLS bulk import), `POST /api/dvir-submit`. Apply §5.0's
rule to each before building: send-invoice needs the Resend key (route); import-customers is parse +
preview only, no DB write until confirm (route, for the parsing step only — the actual insert should
probably be a batch RPC, not client-side inserts as originally sketched); dvir-submit is plain
inserts a driver can already do directly under RLS (`driver_dvir_insert` policy exists) — likely
doesn't need to be a route at all unless the "notify owner immediately on major defect" push
notification needs to be sent from a trusted server context.

### 5.7 Public developer API and its first consumer, `carrieros-mcp` (added Oct 2026)

The public developer API is built (`decisions.md` T14): OAuth 2.0 client-credentials
(`POST /api/public/v1/oauth/token`; clients issued from Settings → Developer API, Growth tier+),
read-only routes under `carrieros-web/app/api/public/v1/` — `loads`, `loads/[id]`, `invoices`,
`invoices/[id]`, `vehicles`, `exceptions`, `financial-events`, `drivers` — plus a public
`openapi.json`. It is a separate trust boundary from the internal `/api/v1/**`. Calls run as a
deliberately least-privilege synthetic `finance` actor, so `drivers` is routed but refused until a
product decision grants that actor the `drivers` capability.

**`carrieros-mcp`** is a separate repo (`github.com/gsanjeevs/carrieros-mcp`) and service: an MCP
(Model Context Protocol) server that exposes the public API as read-only LLM tools (`list_loads`,
`get_load`, `list_invoices`, `get_invoice`, `list_vehicles`, `list_exceptions`,
`list_financial_events`). It holds no CarrierOS database access or business logic of its own — it
authenticates with the same OAuth client credentials any external integration uses, so anything it
can see is bounded by the public API. It runs either as a local stdio process for desktop MCP
clients, or as a hosted, stateless multi-tenant HTTP service (per-request tenant credentials, or MCP
OAuth with PKCE for remote connectors). The hosted instance runs on staging as
`carrieros-mcp-staging-cdk`, defined in this repo's CDK stack (`infra/`); there is no production MCP
deployment. Treat it as a real external consumer: breaking a public API route breaks it. See
`carrieros-mcp/README.md` and `architecture/infrastructure-as-code.md`.

---

## 6. Auth & Role Flow

```
Owner/Solo signs up:
  → POST /api/onboarding (admin client bypass — see §5.2)
  → creates organizations (type='carrier') + carrier_details + profiles row atomically
  → role = 'solo' unless the user explicitly picked 'owner' in the 2-step onboarding form
  → UI shows full owner view + driver-level actions (no role switching needed) when solo

Owner invites Driver (any tier):
  → POST /api/drivers/invite (§5.3) — synchronous, not deferred to first sign-in:
    admin.auth.admin.inviteUserByEmail() → profiles row (role='driver') → drivers row
    (invite_status='pending') all created immediately, before the invitee ever clicks the link
  → Driver clicks the magic link → app/auth/callback/route.ts exchanges the code for a session
    → profiles row already exists → routes straight to /my-loads, invite_status stays 'pending'
    until a "mark accepted" step is added (not yet built)

Owner invites Dispatcher/Finance (Growth+ only):
  → Not yet built — same pattern as driver invite (§5.3) applies: admin client, synchronous
    profile creation, no deferred/metadata-based approach

Login routing (proxy.ts — Next.js 16 renamed middleware.ts, decision T1):
  ROLE_HOME = { owner: '/dashboard', solo: '/dashboard', dispatcher: '/dispatch',
                finance: '/finance', driver: '/my-loads' }
  → new user with no org_id yet → /onboarding
  → otherwise → ROLE_HOME[role]
  → /api/* is exempt from this guard entirely — routes self-authenticate via lib/api-auth.ts (§5.0)

Rate/invoice visibility:
  → loads.rate: never returned in driver queries — query loads_driver_view (§4.3), not loads
  → Dispatcher: RLS allows SELECT on loads but the app must not SELECT the rate column explicitly
  → Finance: has rate access — required for invoicing
```

**Role helpers (`lib/roles.ts`) — planned, not yet built.** Role checks currently happen inline at
each call site (`['owner','solo'].includes(profile.role)`) rather than through a shared helper
module. Worth extracting once enough routes/components repeat the same checks — not blocking.

---

## 7. Key Component Contracts

### `<ExtractionReview />`
```typescript
interface ExtractionReviewProps {
  extracted: ExtractedLoad;
  customerMatch: CustomerMatch | null;
  onConfirm: (data: LoadFormData) => void;
  onBack: () => void;
}
```
Low confidence → amber border + badge. High → green border + badge.

### `<LoadTimeline />`
```typescript
interface LoadTimelineProps {
  events: LoadEvent[];
  currentStatus: LoadStatus;
  isOwner: boolean;   // hides rate/invoice section when false
}
```

### `<TrackingPage />` (public, `/track/[token]`)
- Fetches load by `tracking_token` using anon key
- Never exposes: `rate`, `driver_id`, financials
- Shows: status timeline, last known location (city/state), carrier name, ETA

### `<ImportPreview />`
```typescript
interface ImportPreviewProps {
  rows: ImportRow[];
  summary: ImportSummary;
  onDuplicateAction: (rowId: string, action: 'skip' | 'overwrite') => void;
  onConfirm: () => void;
}
```

### `<DVIRForm />`
```typescript
interface DVIRFormProps {
  loadId?: string;
  truckId: string;
  type: 'pre_trip' | 'post_trip';
  onSubmit: (data: DVIRSubmission) => void;
}
```
Renders FMCSA checklist areas; each area has Pass/Defect toggle; defect adds notes + photo capture.

### `<FleetComplianceDash />`
```typescript
interface FleetComplianceDashProps {
  drivers: DriverComplianceRow[];   // includes cdl_expiry, med_cert_expiry, endorsements
}
// DriverComplianceRow status: 'all_clear' | 'due_soon' | 'incomplete'
// 'due_soon' = expiry within 60 days
// 'incomplete' = required fields missing (no CDL on file)
```

---

## 8. Entity Number Generation

**Not** a `count(*)`-based approach (race condition under concurrent inserts — two simultaneous
requests can both compute the same next number). All entity numbers (load, customer, driver, truck,
invoice) go through the `next_entity_val()` Postgres RPC (§4.4) via `lib/generate-number.ts`:

```typescript
// lib/generate-number.ts — server-side only (also directly RPC-callable from mobile, no wrapper needed there)
async function nextVal(client: SupabaseClient<Database>, companyId: number, entity: Entity): Promise<string> {
  const { data, error } = await client.rpc('next_entity_val', {
    carrier_org_bigint: companyId,
    entity_name:        entity,
  })
  if (error || data == null) throw new Error(`Failed to generate ${entity} number: ${error?.message ?? 'null result'}`)
  return `${PREFIX[entity]}-${data}`   // PREFIX: load 'L', customer 'C', driver 'D', truck 'T', invoice 'INV'
}
```
No fixed-width padding — numbers grow naturally (`L-1`, `L-42`, `L-10523`), not `L-0001`.

---

## 9. Supabase Storage Buckets

**Not yet created** in Supabase (`storage.buckets` is empty as of this writing) — planned for when
POD capture / document upload screens are built. Table below is the plan, not current state.

| Bucket | Access | Contents |
|---|---|---|
| `pod-photos` | Private (owner/solo + driver of that load) | POD photos uploaded by driver |
| `rate-cons` | Private (owner/solo/finance only) | PDF rate confirmations |
| `imports` | Private (owner/solo only) | Uploaded CSV/XLS files |
| `truck-documents` | Private (owner/solo/dispatcher) | Per-truck: registration, insurance, DOT cert |
| `org-documents` | Private (owner/solo + finance read) | Fleet-wide: COI, MC authority, W-9 — renamed from `company-documents` to match the `org_documents` table (§4.2) |
| `dvir-photos` | Private (owner/solo/dispatcher + submitting driver) | Defect photos from DVIR |
| `dvir-signatures` | Private (owner/solo/dispatcher + submitting driver) | Driver signature images |

---

## 10. Expo Setup (Mobile App)

### Two-App Architecture

CarrierOS is two separate apps sharing one Supabase backend:

| App | Folder | Audience | Platform |
|-----|--------|----------|----------|
| `carrieros-web/` | Next.js 16 | Owner desktop, Finance, Dispatcher (desk), public tracking, onboarding | Browser / AWS ECS |
| `carrieros-mobile/` | Expo SDK 57 (React Native) | Driver, Solo/Owner (mobile — the primary MVP persona, see decisions.md "who actually uses mobile") | iOS + Android |

Both apps connect to the **same Supabase project** — same schema, same auth, same RLS policies.
`supabase gen types typescript --local` generates `carrieros-web/types/supabase.ts`; copy it into
`carrieros-mobile/src/types/database.ts` whenever the schema changes (no automated sync yet).

---

### Expo App Bootstrap — as actually done

`carrieros-mobile/` started from `npx create-expo-app carrieros-mobile --template tabs` (decision
T7 — never AI-scaffold, always the real CLI), which already includes `expo-router`. The remaining
packages were added on top with `npx expo install`, not re-scaffolded:

```bash
cd carrieros-mobile
npx expo install expo-location expo-camera expo-image-picker expo-notifications \
  expo-secure-store expo-file-system expo-document-picker expo-localization \
  @supabase/supabase-js react-native-url-polyfill @react-native-async-storage/async-storage i18n-js
```
`expo install` auto-registered `expo-secure-store` and `expo-localization` as config plugins in
`app.json`. As of this writing: packages are installed, but only Supabase auth/session/data-fetching
is wired up — location, camera, notifications, and i18n-js are installed and unused.

---

### `app.json`

**Not yet applied.** The real `app.json` is still the default scaffold — `name`/`slug`:
"carrieros-mobile", `scheme`: "carrierosmobile", no `bundleIdentifier`/`package`, no
camera/location/notification permission descriptions, only `expo-secure-store` and
`expo-localization` in `plugins` (auto-added by `expo install`, §10 bootstrap). The block below is
the target config for when native camera/location/push work actually starts (currently unbuilt —
see §5.6, §10 bootstrap note):

```json
{
  "expo": {
    "name": "CarrierOS",
    "slug": "carrieros",
    "version": "1.0.0",
    "scheme": "carrieros",
    "platforms": ["ios", "android"],
    "ios": {
      "bundleIdentifier": "com.carrieros.app",
      "infoPlist": {
        "NSLocationAlwaysAndWhenInUseUsageDescription": "CarrierOS logs your state crossings while driving to calculate IFTA mileage automatically.",
        "NSLocationAlwaysUsageDescription": "CarrierOS logs your state crossings while driving to calculate IFTA mileage automatically.",
        "NSCameraUsageDescription": "CarrierOS uses your camera to capture proof-of-delivery photos.",
        "NSPhotoLibraryUsageDescription": "CarrierOS accesses your photo library to attach photos to loads."
      }
    },
    "android": {
      "package": "com.carrieros.app",
      "permissions": [
        "ACCESS_BACKGROUND_LOCATION",
        "ACCESS_FINE_LOCATION",
        "CAMERA",
        "READ_EXTERNAL_STORAGE"
      ]
    },
    "plugins": [
      ["expo-router"],
      ["expo-location", { "locationAlwaysAndWhenInUsePermission": "CarrierOS logs state crossings for IFTA mileage." }],
      ["expo-notifications"]
    ]
  }
}
```

---

### Expo Project Structure — as actually implemented

Root is `src/app/` (Expo Router auto-detects this — "Using src/app as the root directory for Expo
Router" on start), **not** plain `app/` as the plan below once assumed. There is one `(tabs)` route
group for the authenticated tab bar, not separate `(driver)`/`(owner)` groups — everything unauthenticated
lives outside it so `/login` isn't wrapped in tabs. Tab bar uses `expo-router/unstable-native-tabs`
(the scaffold's default, not the classic `<Tabs>` component the original plan assumed).

```
carrieros-mobile/
├── src/
│   ├── app/
│   │   ├── _layout.tsx                # Root layout: AuthGate (redirect to /login if no session,
│   │   │                               # away from /login if there is one — checks usePathname()
│   │   │                               # to avoid a redirect loop) + ThemeProvider + Slot
│   │   ├── login.tsx                  # Supabase auth — same credentials as web
│   │   └── (tabs)/
│   │       ├── _layout.tsx            # Renders AppTabs (unstable-native-tabs)
│   │       ├── index.tsx              # "My Loads" — role-aware: loads_driver_view (driver) or
│   │       │                          # loads (owner/solo/dispatcher/finance), direct Supabase call
│   │       └── explore.tsx            # Scaffold default, unmodified
│   ├── components/
│   │   └── app-tabs.tsx (+ app-tabs.web.tsx)   # Scaffold defaults — real tab bar/branding not built
│   ├── hooks/
│   │   └── use-session.ts             # Reactive session via supabase.auth.onAuthStateChange
│   ├── lib/
│   │   └── supabase.ts                # createClient for React Native (see below — has an SSR guard)
│   └── types/
│       └── database.ts                # Copied from carrieros-web/types/supabase.ts
└── .env                                # EXPO_PUBLIC_SUPABASE_URL/ANON_KEY — see §11
```

**Not yet built:** `dvir/`, `fuel/`, `mileage/`, `profile.tsx`, `load/[id].tsx`, `ChatThread`,
`GPSStatusBadge`, `lib/gps.ts`, `lib/notifications.ts`, `lib/i18n.ts`, `eas.json`. The GPS/push/EAS
subsections below remain the plan for when that work starts.

---

### Supabase Client (React Native) — with an SSR guard

```typescript
// src/lib/supabase.ts
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Database } from '@/types/database';

// Expo Router's web target renders once on the server (Node, no `window`)
// before hydrating in the browser. AsyncStorage's web backend touches
// `window.localStorage` on import, which crashes the whole SSR pass with
// "window is not defined" — hit for real running `expo start --web` for
// verification. Only matters for the web target; native iOS/Android never
// hits this path. Fix: a no-op storage fallback during SSR.
const isServer = typeof window === 'undefined';
const storage = isServer
  ? { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }
  : AsyncStorage;

export const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,       // required for React Native (no browser URL)
    },
  }
);
```

Verified live (not just typechecked): a real login through this client, in the actual mobile UI
rendered via `expo start --web`, against real Supabase data created through the web API — see
`docs/resume.md` "carrieros-mobile foundation started".

---

### GPS — State Crossing Detection (Growth tier)

```typescript
// lib/gps.ts
import * as Location from 'expo-location';
import stateGeoJSON from '../assets/us-states.json';  // ~300KB bundled boundary file

export async function requestLocationPermission(): Promise<boolean> {
  // Request "Always" permission — required for background tracking
  const { status } = await Location.requestBackgroundPermissionsAsync();
  return status === 'granted';
}

export function startStateTracking(loadId: string, onCrossing: (state: string) => void) {
  let lastState: string | null = null;

  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, timeInterval: 15 * 60 * 1000 },  // 15 min
    ({ coords }) => {
      const currentState = getStateFromCoords(coords.latitude, coords.longitude, stateGeoJSON);
      if (currentState && currentState !== lastState) {
        lastState = currentState;
        onCrossing(currentState);     // caller inserts to ifta_state_crossings
      }
    }
  );
}

function getStateFromCoords(lat: number, lng: number, geoJSON: any): string | null {
  // Point-in-polygon check against bundled GeoJSON — works fully offline
  // Use @turf/boolean-point-in-polygon (lightweight, tree-shakeable)
  for (const feature of geoJSON.features) {
    if (pointInPolygon([lng, lat], feature.geometry)) {
      return feature.properties.STUSPS;  // 2-letter state code
    }
  }
  return null;
}
```

---

### Push Notifications

```typescript
// lib/notifications.ts
import * as Notifications from 'expo-notifications';

export async function registerForPushNotifications(): Promise<string | null> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return null;
  const token = await Notifications.getExpoPushTokenAsync();
  return token.data;  // store in profiles.push_token (add column to schema)
}

// Supabase Edge Function sends push via Expo Push API:
// POST https://exp.host/--/api/v2/push/send
// { to: push_token, title: "New load assigned", body: "L-0094 Fresno → LA" }
```

---

### EAS Build

```json
// eas.json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "info@shipmentx.com" },
      "android": { "serviceAccountKeyPath": "./google-service-account.json" }
    }
  }
}
```

```bash
# Development
npx expo start                    # Expo Go for quick testing
eas build --profile development   # Dev build with native modules

# Production
eas build --platform all          # iOS + Android
eas submit --platform all         # App Store + Play Store
eas update                        # OTA update (JS bundle only — no App Store review)
```

---

### Environment Variables (Expo)

```bash
# .env (Expo uses EXPO_PUBLIC_ prefix for client-side vars)
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

Note: No `SUPABASE_SERVICE_ROLE_KEY` in the mobile app — service role is only used in Next.js API routes (server-side).

---

## 11. Environment Variables

```bash
# carrieros-web/.env.local
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=      # Supabase "publishable key"
SUPABASE_SERVICE_ROLE_KEY=          # Supabase "secret key" — API routes only, never client
ANTHROPIC_API_KEY=                  # AI extraction (claude-haiku-4-5) — set, in use
# Not yet set (features not built): RESEND_API_KEY, RESEND_WEBHOOK_SECRET, NEXT_PUBLIC_APP_URL

# carrieros-mobile/.env — points at local Supabase (127.0.0.1); fine for
# simulator/web preview, needs the Mac's LAN IP for a physical device
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

---

## 12. Build Order for AI Coding

**Live status — see `docs/resume.md` for the authoritative, frequently-updated version of this list.**
This section is the condensed snapshot as of this refresh; resume.md is the one to trust if they drift.

1. ✅ Supabase setup — schema v4.0, RLS, `next_entity_val`/`create_customer_org` RPCs, types generated
2. ✅ Auth flow — login, `proxy.ts` role routing, `lib/api-auth.ts` dual auth (cookie + Bearer)
3. ✅ Load intake — paste → `/api/extract-load` (Claude Haiku) → `<ExtractionReview />` → save
4. ✅ Load list + detail — status timeline, route, `<DispatchPanel />`
5. ✅ Dispatch — assign driver + truck, status via `PATCH /api/loads/[id]`
6. ✅ Onboarding — 2-step form, atomic org+carrier_details+profile, auto-derived timezone/UOM/currency
7. ✅ Driver invite (backend) — `POST /api/drivers/invite`, magic link, synchronous profile+drivers row
8. ✅ carrieros-mobile foundation — Supabase client, auth guard, login, real-data "My Loads" screen
9. ✅ Driver add form + truck add form (frontend, calling the invite/trucks endpoints)
10. ✅ Invoice flow — `invoices.payment_method` + factoring columns added (decision R1); list, detail,
    create-from-load, mark sent (real SMTP send via local Mailpit relay, decision T13), mark paid,
    factoring notify-stub (decision T12)
11. ✅ Tracking page `/track/[token]` — public, no auth; enriched 2026-07-20 with a carrier contact
    card and a status timeline (`get_public_tracking_events` RPC, event_type+created_at only — never
    `load_events.note`, see decisions.md's RLS-audit entries for why that boundary matters)
12. ✅ Team management UI — dispatcher/finance/owner invite, role change, removal (mirrors driver
    invite pattern, §5.3); self-role-change and last-owner-removal both blocked server-side
13. ✅ **Mobile driver loop** — load detail + status update, pre/post-trip DVIR (with defect photos),
    POD capture, all via the `documents` Storage bucket (decision T11)
14. ✅ Maintenance (`/maintenance` — per-truck reminders + service log, built 2026-07-20) and
    ✅ Customer directory (`/customers`, built 2026-07-20). Still not started: org documents
    (`/documents` nav item is a stub), CSV customer import, a dedicated compliance dashboard, and the
    exceptions/alert-banner system design-gap-analysis.md's section 3.2 describes.
15. ✅ Demo-mode Stripe billing (`/billing`) — card-on-file simulated via Stripe's own published test
    constant, no real card field anywhere; real integration is one function body away once a Stripe
    account exists (decision T12)

---

## 14. Internationalisation (i18n)

### i18n Scope — All Six Dimensions

| Dimension | MVP Decision | How Handled |
|---|---|---|
| **Language** | EN / ES / PA — all roles | `next-intl` translation strings; `profiles.preferred_language` |
| **Date/Time** | US locale formats | Use `intl.formatDate()` / `intl.formatDateTime()` everywhere — never hardcode format strings. `next-intl` wraps `Intl.DateTimeFormat` natively. |
| **Units** | Miles, lbs, gallons — US only | No conversion. Hardcode US units for MVP. Declare `locale: 'en-US'` in Intl calls. Post-MVP: abstract into a unit config per company. |
| **Currency** | USD only | Format with `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`. Do not hardcode `$` — use the formatter. Post-MVP: per-company currency config for Canada/Mexico routes. |
| **Address format** | US-only (street, city, state, zip) | No adaptation needed. All loads, customers, and company profiles use US address fields. |
| **RTL layout** | Required for Urdu | Punjabi (Gurmukhi) is LTR — no layout work needed. Urdu (Nastaliq) is RTL. When `locale === 'ur'`, set `dir="rtl"` on the root layout element. Flex directions, icon positions, and text alignment mirror automatically. Test all driver screens in RTL — pay special attention to route display (origin → dest flips to dest ← origin) and button placement. |

> **Dev rule:** Always use `intl.*` formatters for dates, numbers, and currency — never template literal strings like `` `$${amount}` `` or `date.toLocaleDateString()`. This ensures correct formatting when the locale changes and keeps the codebase post-MVP-ready.

### Supported Languages

| Code | Language | Script | Direction | Rationale |
|------|----------|--------|-----------|-----------|
| `en` | English | Latin | LTR | Default |
| `es` | Spanish | Latin | LTR | Large Spanish-speaking driver population across US trucking corridors |
| `pa` | Punjabi | Gurmukhi | LTR | Sikh driver community concentrated in CA, Pacific Northwest — key CA pilot demographic |
| `ur` | Urdu | Nastaliq | **RTL** | Pakistani driver community in CA; significant overlap with South Asian trucking workforce alongside Punjabi speakers |

### Library
Use **`next-intl`** — works natively with the Next.js App Router (14 or 16); no wrapper components needed. Not yet installed or wired up — `messages/*.json` doesn't exist yet (§3).

```bash
npm install next-intl
```

Update `next.config.js`:
```js
const withNextIntl = require('next-intl/plugin')('./i18n.ts');
module.exports = withNextIntl({ /* no output:'export' needed — Expo handles mobile separately */ });
```

### Language Selection Flow
- All users see a language picker — available to every role (owner, driver, dispatcher, finance)
- Preference stored in `profiles.preferred_language` (not role-specific)
- Language picker shown:
  - **All users:** Account settings page → Language field
  - **Drivers:** Also shown as the first step of profile setup on first login
- Language names shown in their own script: **English / Español / ਪੰਜਾਬੀ**
- Selection saved to `profiles.preferred_language` in Supabase
- Layout reads `preferred_language` from profile → passes locale to `NextIntlClientProvider`
- **Web:** Cached in `localStorage` as fallback when offline
- **Mobile (Expo):** Cached in `AsyncStorage` via `@react-native-async-storage/async-storage` — persists across app restarts

Language preference is **global** — it follows the driver, not the company. If a driver works for multiple carriers, their language stays consistent.

### Font Loading — Non-Latin Scripts

Both Punjabi (Gurmukhi) and Urdu (Nastaliq) require custom fonts. Load conditionally — do not load both for all users.

```html
<!-- In app/layout.tsx — load only when locale requires it -->
<link rel="preconnect" href="https://fonts.googleapis.com" />

<!-- Punjabi -->
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Gurmukhi:wght@400;600;700&display=swap" rel="stylesheet" />

<!-- Urdu -->
<link href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap" rel="stylesheet" />
```

Apply conditionally in `/(driver)/layout.tsx`:
```typescript
const locale = profile.preferred_language;

const fontStyle =
  locale === 'pa' ? { fontFamily: "'Noto Sans Gurmukhi', sans-serif" } :
  locale === 'ur' ? { fontFamily: "'Noto Nastaliq Urdu', serif" } :
  {};

const dir = locale === 'ur' ? 'rtl' : 'ltr';
```

Pass `dir` to the root `<div>` or `<html>` element. All flex layouts, icon placements, and text alignment will mirror automatically with `dir="rtl"` — no per-component changes needed for most cases. Exception: route display (origin → destination) must be explicitly reversed for RTL.

### Translation File Structure
Keys should mirror screen → component → string. Example `messages/en.json`:
```json
{
  "dvir": {
    "title": "Pre-Trip Inspection",
    "instructions": "Tap any area of the truck to log a defect",
    "zones": {
      "front": "Front / Cab",
      "engine": "Engine Bay",
      "tires": "Drive Tires",
      "trailer": "Trailer Body",
      "rear": "Rear & Lights"
    },
    "condition": {
      "satisfactory": "Satisfactory — no defects",
      "defects_noted": "Defects noted"
    },
    "severity": { "minor": "Minor", "major": "Major — do not drive" }
  },
  "status": {
    "update": "Update Status",
    "picked_up": "Picked Up",
    "in_transit": "In Transit",
    "delivered": "Delivered"
  },
  "pod": {
    "capture": "Capture Proof of Delivery",
    "instructions": "Take a clear photo of the signed BOL or delivery receipt"
  }
}
```

### Priority Strings for Launch
Translate these first — highest driver interaction frequency and highest compliance risk if misunderstood:
- All DVIR zone names, checklist items, defect severity levels
- Status update button labels and confirmation messages
- POD capture instructions
- Driver profile field labels (CDL, med cert, endorsements)
- Error messages and alerts

### Competitive Note
No competitor at this price point offers Punjabi or Urdu. Spanish is uncommon at the Starter tier. This is a specific and credible differentiator for the CA pilot — carriers with Punjabi-speaking (Sikh), Urdu-speaking (Pakistani), or Spanish-speaking drivers have no good option today. Urdu adds meaningful complexity (RTL layout) but serves a real and underserved driver population in CA.

---

## 13. Reference Files

All files are under `General/Product/Carrier Portal/` in Zoho Drive.

| File | Purpose |
|---|---|
| `resume.md` | **Start here for "where were we"** — frequently-updated session state, current build-order status, bugs found+fixed. Faster than re-reading this whole file. |
| `decisions.md` | Locked product/pricing/schema/technical decisions with rationale (why, what it rules out). Check before making a call this file doesn't cover. |
| `carrieros-db/schema.sql` | **Schema source of truth** — §4 above mirrors it; if they disagree, schema.sql wins |
| `strategy/prd.md` | Full PRD — roles, user stories, P0 requirements, edge cases |
| `strategy/tier-pricing-structure.md` | Feature gating by tier (Starter / Growth / Pro / Enterprise) |
| `design/carrieros-prototype-index.html` | Master mockup hub — open this first for design reference |
| `design/carrieros-role-matrix.html` | Dev reference: full permission matrix + RLS notes |
| `design/mockups/mockup-01` through `mockup-17` | Individual flow mockups (screen-by-screen UI reference) |

---

## 15. Post-MVP Schema — Planned Tables by Tier

These tables are **not in the current schema.sql**. Updated to match the v4.0 conventions
(`BIGSERIAL` PKs, `carrier_org_id` not `company_id`, `organizations(id)` not `companies(id)` —
decisions S2/S5) so they drop in cleanly whenever each tier's work actually starts; the original
draft (still `UUID`/`company_id`/`companies`) predates the v4.0 migration. Do not create these
tables yet.

**Also needed before invoicing (decision R1, not yet in schema.sql):** `invoices.payment_method
TEXT CHECK (payment_method IN ('stripe','factoring','other'))` — both Stripe direct and factoring
integrations are supported per the decision, a carrier picks per-invoice or globally.

### Growth Tier (post-MVP)

```sql
-- Fuel stop logging (Starter: manual log; Growth: GPS-assisted)
CREATE TABLE fuel_stops (
  id               BIGSERIAL PRIMARY KEY,
  carrier_org_id   BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  truck_id         BIGINT REFERENCES trucks(id),
  driver_id        BIGINT REFERENCES drivers(id),
  load_id          BIGINT REFERENCES loads(id),        -- null if not tied to a load
  stop_date        DATE NOT NULL,
  state            TEXT NOT NULL,                       -- 2-letter state code (IFTA reporting)
  location_name    TEXT,
  gallons          NUMERIC(8,3) NOT NULL,
  price_per_gallon NUMERIC(6,3),
  total_cost       NUMERIC(10,2),
  receipt_path     TEXT,                                -- Supabase Storage path
  odometer         INT,
  created_by       UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- IFTA state crossings — auto-logged via GPS or manually entered as fallback (Growth tier)
-- One row per state-boundary crossing event
CREATE TABLE ifta_state_crossings (
  id             BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  truck_id       BIGINT REFERENCES trucks(id),
  driver_id      BIGINT REFERENCES drivers(id),
  load_id        BIGINT REFERENCES loads(id),
  state          TEXT NOT NULL,                         -- state being entered (2-letter)
  crossed_at     TIMESTAMPTZ NOT NULL,
  lat            NUMERIC,                                -- null for manual entries
  lng            NUMERIC,                                -- null for manual entries
  odometer_est   INT,                                    -- miles in this state (GPS-estimated or driver-entered)
  source         TEXT NOT NULL DEFAULT 'gps'             -- 'gps' | 'manual'
                 CHECK (source IN ('gps', 'manual')),
  created_at     TIMESTAMPTZ DEFAULT now()
);
-- Quarterly summary computed from this table — see ifta_quarterly_summary view (Pro tier)

-- GPS COMPLETENESS CHECK + ODOMETER FALLBACK (Growth tier — see mockup-20 Screen 4)
--
-- On load delivery, before marking load status = 'delivered':
--   1. SELECT SUM(odometer_est) FROM ifta_state_crossings WHERE load_id = $load_id
--   2. Compare to loads.total_miles
--   3. If SUM < 60% of total_miles → GPS data incomplete → show odometer fallback UI
--   4. If SUM >= 60% → GPS data acceptable → proceed to delivery confirmation
--
-- Odometer fallback behavior:
--   - Pre-fill each state's input with its GPS-logged odometer_est (if any)
--   - Driver corrects/enters miles per state manually
--   - On save: DELETE all rows WHERE load_id = $load_id AND source = 'gps'
--              INSERT new rows with source = 'manual' (no lat/lng, crossed_at = now())
--   - Manual rows override GPS entirely — never mix sources for the same load
--
-- iOS background location note:
--   - GPS polling requires "Always Allow" location permission (not "While Using")
--   - Show a one-time prompt at Growth tier activation explaining IFTA accuracy dependency
--   - If permission is "While Using" only → GPS stops when app backgrounds → completeness
--     check will trigger fallback for most trips → prompt driver to update permission
--
-- Owner IFTA summary display:
--   - Flag loads where ANY row has source = 'manual' with a ✎ indicator
--   - Tooltip: "Mileage entered manually — GPS was unavailable for this trip"

-- Driver in-app messages (Growth tier — dispatcher ↔ driver per load)
CREATE TABLE driver_messages (
  id             BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  load_id        BIGINT REFERENCES loads(id) ON DELETE CASCADE,
  sender_id      UUID REFERENCES profiles(id),
  body           TEXT NOT NULL,
  sent_at        TIMESTAMPTZ DEFAULT now(),
  read_at        TIMESTAMPTZ                             -- null until read by recipient
);
```

### Pro Tier (post-MVP)

```sql
-- Driver settlements (per-trip pay calculations)
CREATE TABLE driver_settlements (
  id              BIGSERIAL PRIMARY KEY,
  carrier_org_id  BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  driver_id       BIGINT REFERENCES drivers(id),
  load_id         BIGINT REFERENCES loads(id),
  pay_method      TEXT CHECK (pay_method IN ('per_mile','percentage','flat')),
  rate_value      NUMERIC(10,4),                        -- miles rate, % (0–1), or flat $
  miles           INT,
  gross_revenue   NUMERIC(10,2),
  driver_pay      NUMERIC(10,2),
  deductions      JSONB,                                -- [{label, amount}] e.g. fuel advance
  net_pay         NUMERIC(10,2),
  payment_method  TEXT CHECK (payment_method IN ('ach','check','cash','zelle')),
  payment_status  TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending','sent','cleared')),
  paid_at         TIMESTAMPTZ,
  period_start    DATE,
  period_end      DATE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Carrier public profile (carrieros.app/carrier/[mc_number])
CREATE TABLE carrier_profiles (
  id               BIGSERIAL PRIMARY KEY,
  carrier_org_id   BIGINT REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  mc_number        TEXT NOT NULL UNIQUE,
  dot_number       TEXT,
  is_public        BOOLEAN DEFAULT false,               -- false = draft/hidden
  tagline          TEXT,
  equipment_types  TEXT[],                               -- ['dry_van','flatbed','reefer',...]
  service_lanes    TEXT[],                                -- ['CA→AZ','CA→OR',...]
  insurance_amount INT,                                  -- thousands USD
  logo_path        TEXT,
  published_at     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Load board postings (DAT + Truckstop — Pro tier)
CREATE TABLE load_board_postings (
  id             BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  load_id        BIGINT REFERENCES loads(id),
  board          TEXT NOT NULL CHECK (board IN ('dat','truckstop')),
  external_id    TEXT,                                  -- ID returned by DAT/Truckstop API
  status         TEXT DEFAULT 'pending' CHECK (status IN ('pending','active','filled','expired','cancelled')),
  posted_at      TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- IFTA quarterly summary view (computed from ifta_state_crossings + fuel_stops)
-- CREATE as a VIEW or materialized view — not a raw table
-- Formula per state: (miles_in_state / total_miles × total_fuel × state_rate) − fuel_purchased_in_state × state_rate
-- Positive = tax owed; Negative = credit
-- Reference: design/mockups/mockup-17 shows the full UI for this view
```

### RLS Notes for Post-MVP Tables
- All post-MVP tables follow the same carrier-scoped pattern: `carrier_org_id = my_org_id()` (use
  the helper functions from §4.5, not a direct `profiles` subquery — safer default given the
  recursion bug found this session)
- `driver_messages`: sender can read their own messages; Owner/Dispatcher/Solo can read all messages for their carrier org
- `driver_settlements`: Finance + Owner + Solo can read/write; Driver can read their own rows only
- `carrier_profiles`: Owner/Solo can write; public rows readable by anon (for public profile page)
- `load_board_postings`: Owner/Solo/Dispatcher can read; only Owner/Solo can post/cancel
- `fuel_stops`: Owner/Solo can CRUD; Driver can INSERT for their own truck; Finance/Dispatcher read-only
- `ifta_state_crossings`: GPS rows system-inserted via Edge Function; Driver can INSERT/DELETE rows for their own loads (needed for manual odometer fallback — Driver deletes GPS rows and inserts manual rows on delivery); Owner/Solo/Finance read-only

---

## 16. Timezone & Units of Measure (UOM)

### Design Decisions

**As actually implemented, timezone/UOM/currency are all auto-derived at onboarding from
country+state — there is no manual picker for any of them (decision S7), which supersedes the
"Owner selects during onboarding" framing this section originally had.** Rationale: timezone dropdowns
have 500+ options and users pick the wrong one; country+state uniquely determines timezone for 99%
of US/CA/MX carriers. See `deriveTimezone()` in `app/api/onboarding/route.ts` (§5.2) for the actual
lookup table (all 50 US states + DC, Canadian provinces, Mexico).

**Timezone — two-level resolution (carrier default + user override):**
- All timestamps stored in the database as UTC (`TIMESTAMPTZ`) — no exceptions.
- Resolved timezone for display: `profiles.timezone` (user override) → `carrier_details.timezone` (carrier default, auto-derived) → `'America/Los_Angeles'` (system fallback).
- Any user CAN still override their own timezone in Account Settings → stored on `profiles.timezone` — that override path is unchanged, only the *initial* carrier default is no longer manually chosen.
- Drivers self-set a timezone override during profile setup (same screen as language selection) — not yet built.

**UOM — carrier-level only, no per-user override, auto-derived from country:**
- Rationale: fleet consistency matters more than individual preference. A carrier shouldn't have one driver logging miles and another logging km on the same truck.
- Auto-derived at onboarding: `country === 'CA' ? 'metric' : 'imperial'`; stored on `carrier_details.uom_system`.
- All distance/fuel/weight values stored in **imperial units** in the DB regardless of setting. UOM conversion happens at display time only.

**Currency — also auto-derived from country, not covered by this section originally:**
- `organizations.currency`: `country === 'CA' ? 'CAD' : country === 'MX' ? 'MXN' : 'USD'` — set on
  the carrier's own `organizations` row at onboarding (§5.2), and independently on each customer's
  `organizations` row when created via `create_customer_org` (defaults `'US'`→`'USD'` unless a
  country is passed).

### Schema Additions

```sql
-- carrier_details table (§4.1):
timezone   TEXT DEFAULT 'America/Los_Angeles',   -- IANA tz; auto-derived from country+state at onboarding
uom_system TEXT DEFAULT 'imperial'               -- 'imperial' | 'metric'; auto-derived from country
           CHECK (uom_system IN ('imperial','metric')),

-- organizations table (§4.1):
currency   TEXT DEFAULT 'USD' CHECK (currency IN ('USD','CAD','MXN')),  -- auto-derived from country

-- profiles table (§4.1):
timezone   TEXT,  -- NULL = inherit carrier_details.timezone; set = user override (IANA string)
```

### Timezone Resolution Helper (web — Next.js)

```typescript
// lib/timezone.ts
export function resolveTimezone(
  userTz: string | null,
  companyTz: string
): string {
  return userTz ?? companyTz ?? 'America/Los_Angeles';
}

// Usage: format a UTC timestamp for display
import { format } from 'date-fns-tz';

export function formatInTz(
  utcDate: Date | string,
  timezone: string,
  fmt = 'MMM d, yyyy h:mm a'
): string {
  return format(new Date(utcDate), fmt, { timeZone: timezone });
}
```

### Timezone Resolution Helper (mobile — Expo)

```typescript
// lib/timezone.ts (carrieros-mobile)
import * as Localization from 'expo-localization';

export function resolveTimezone(
  userTz: string | null | undefined,
  companyTz: string
): string {
  return userTz ?? companyTz ?? Localization.getCalendars()[0]?.timeZone ?? 'America/Los_Angeles';
}
```

### UOM Conversion Helpers

```typescript
// lib/uom.ts — all values stored as imperial; convert at display time only
type UomSystem = 'imperial' | 'metric';

export const uom = {
  distance: (miles: number, system: UomSystem) =>
    system === 'metric'
      ? `${(miles * 1.60934).toFixed(1)} km`
      : `${miles.toLocaleString()} mi`,

  fuel: (gallons: number, system: UomSystem) =>
    system === 'metric'
      ? `${(gallons * 3.78541).toFixed(1)} L`
      : `${gallons.toFixed(3)} gal`,

  weight: (lbs: number, system: UomSystem) =>
    system === 'metric'
      ? `${(lbs * 0.453592).toFixed(0)} kg`
      : `${lbs.toLocaleString()} lbs`,
};

// Usage:
// uom.distance(load.total_miles, carrier.uom_system)  → "482 mi" or "775.8 km"
// uom.fuel(stop.gallons, carrier.uom_system)          → "85.000 gal" or "321.8 L"
```

### i18n + Locale for Number/Date Formatting

UOM display uses the i18n locale for number formatting (comma separators etc.):

| Language | Locale | Number format |
|----------|--------|---------------|
| English  | `en-US` | 1,234.5 |
| Spanish  | `es-MX` | 1.234,5 |
| Punjabi  | `pa-IN` | 1,234.5 |
| Urdu     | `ur-PK` | 1,234.5 |

```typescript
// Locale-aware number formatting
export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}
```

### Onboarding — as actually implemented (no manual timezone/UOM step)

Company setup (step 1 of the 2-step onboarding form, `app/onboarding/page.tsx`) collects
`company_name`, `mc_number`, `dot_number`, `country`, `state`, `city` — **no timezone or units
prompt**. `POST /api/onboarding` derives `timezone`, `uom_system`, and `currency` server-side from
`country`+`state` (§5.2, §16 Schema Additions above) before any of the three inserts happen.

Driver profile setup (after invite accepted) still needs a timezone override field per the original
plan — optional, pre-filled from device timezone, label "Your local timezone (leave unchanged to use
company default)" — not yet built (driver profile screens don't exist yet, §12).

### Supabase Settings Queries

```typescript
// Fetch resolved settings for a user session (run once on login, cache in context)
const { data } = await supabase
  .from('profiles')
  .select('timezone, preferred_language, org_id, organizations(currency, carrier_details(timezone, uom_system))')
  .eq('id', userId)
  .single();

const timezone   = resolveTimezone(data.timezone, data.organizations.carrier_details.timezone);
const uomSystem  = data.organizations.carrier_details.uom_system as UomSystem;
const currency   = data.organizations.currency;
const locale     = LOCALE_MAP[data.preferred_language]; // e.g. 'es' → 'es-MX'
```

---

## 17. Super Admin — Platform Operator Architecture

Design reference: `design/mockups/mockup-23-super-admin.html` (click "Build Spec" in the file).
Decision log: `decisions.md` SA1–SA6.

### Auth Surface (separate from Supabase Auth)

Super admin is a wholly separate auth surface — never a `profiles.role` value, never a Supabase Auth JWT.

```
platform_admins
  id            BIGSERIAL PRIMARY KEY
  email         TEXT UNIQUE NOT NULL
  password_hash TEXT NOT NULL          -- bcrypt, cost 12
  totp_secret   TEXT NOT NULL          -- TOTP 2FA mandatory, no bypass
  last_login_at TIMESTAMPTZ
  created_at    TIMESTAMPTZ DEFAULT now()
```

Session: signed HTTP-only cookie (`platform_session`), 8-hour TTL, rotated on each request. Never stored in Supabase Auth. Login endpoint: `POST /admin/api/auth/login` (separate Next.js route group `app/(admin)/`).

**Why not Supabase Auth:** A Supabase JWT contains the user's `role` claim — there is no safe way to elevate that to platform-admin level without it being visible in a token a carrier user could intercept. Separate table = separate attack surface.

### New DB Tables Required

```sql
-- Internal notes on orgs, written by platform admins
CREATE TABLE admin_notes (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES organizations(id),
  body          TEXT NOT NULL,
  admin_user_id BIGINT NOT NULL REFERENCES platform_admins(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Cross-org audit log (all significant events written here by app code)
CREATE TABLE admin_events (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT REFERENCES organizations(id),  -- NULL for system events
  user_id     UUID REFERENCES auth.users(id),        -- NULL for anonymous/webhook
  event_type  TEXT NOT NULL,  -- 'auth.login' | 'auth.failed' | 'load.created' | 'billing.*' | 'admin.impersonate' | ...
  metadata    JSONB,
  ip          INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Stripe webhook mirror for billing screen
CREATE TABLE billing_events (
  id              BIGSERIAL PRIMARY KEY,
  org_id          BIGINT REFERENCES organizations(id),
  stripe_event_id TEXT UNIQUE,
  event_type      TEXT NOT NULL,  -- 'charge.succeeded' | 'charge.failed' | 'customer.subscription.deleted' | ...
  amount_cents    INT,
  currency        TEXT DEFAULT 'usd',
  status          TEXT,           -- 'succeeded' | 'failed' | 'pending'
  card_last4      TEXT,
  resolved_at     TIMESTAMPTZ,   -- NULL = still needs action
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Feature flags + per-org overrides
CREATE TABLE feature_flags (
  key             TEXT PRIMARY KEY,
  description     TEXT,
  default_enabled BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE org_flag_overrides (
  org_id      BIGINT NOT NULL REFERENCES organizations(id),
  flag_key    TEXT NOT NULL REFERENCES feature_flags(key),
  enabled     BOOLEAN NOT NULL,
  set_by      BIGINT REFERENCES platform_admins(id),
  set_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (org_id, flag_key)
);
```

None of these tables have RLS — they are only ever queried by the admin API routes using `createAdminClient()` (service role). Carrier app code never touches them.

### Customer Health Score

Computed on read (not stored), exposed via a Postgres function:

```
health_score = (login_recency_score × 30)
             + (load_velocity_score × 35)
             + (feature_depth_score × 35)
```

Each sub-score is 0.0–1.0 normalised before weighting. Thresholds: ≥70 green / ≥40 amber / <40 red.

**Feature depth milestones (7 total):** onboarding complete · first vehicle added · first customer added · first load created · first load dispatched · first invoice sent · first payment received.

### Exception Severity Grouping (Triage Queue)

| Severity | Color | Examples |
|---|---|---|
| Critical | Red | Payment failed, card expired >7d, charge.failed ×2 |
| High | Orange | Trial expiring <7d, load volume drop >50%, payment day 1 |
| Medium | Amber | New signup stuck (no load after 7d), open support ticket, invoice overdue 30d |
| Low | Blue | New signup on-track (FYI), day-2 check-in candidates |

### Impersonate Flow

`POST /admin/api/orgs/[id]/impersonate` (admin-authed route):
1. Calls `createAdminClient().auth.admin.generateLink({ type: 'magiclink', email: ownerEmail })`
2. Returns the magic link — admin opens it in an incognito window
3. Writes an `admin_events` row: `event_type = 'admin.impersonate'`, `metadata.target_org_id`, `metadata.admin_id`

Never stores the magic link or logs it beyond the audit row.

### API Route Group

All super admin routes live under `app/(admin)/admin/api/` — a separate Next.js route group with its own layout that checks the platform session cookie (not Supabase Auth). The `(admin)` group is excluded from `proxy.ts` matcher entirely.

```
POST /admin/api/auth/login       — bcrypt verify + TOTP check → set platform_session cookie
POST /admin/api/auth/logout      — clear platform_session cookie
GET  /admin/api/orgs             — list all orgs with health scores
GET  /admin/api/orgs/[id]        — org detail (usage, adoption, users, notes)
POST /admin/api/orgs/[id]/notes  — add admin note
POST /admin/api/orgs/[id]/tier   — change tier
POST /admin/api/orgs/[id]/trial  — extend trial_ends_at
POST /admin/api/orgs/[id]/impersonate — generate magic link for owner
POST /admin/api/orgs/[id]/suspend     — set billing_status = 'suspended'
GET  /admin/api/billing          — failed charges + expiring cards (billing_events + Stripe API)
POST /admin/api/billing/[id]/retry    — Stripe charge retry
GET  /admin/api/events           — paginated admin_events log
GET  /admin/api/flags            — feature flags + overrides
PUT  /admin/api/flags/[key]      — update flag default or org override
```
