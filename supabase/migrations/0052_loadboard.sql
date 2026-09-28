-- 0052_loadboard.sql
--
-- DAT load-board integration, Phase 1 (posting only, mocked DAT client — user request, 2026-09-27).
-- Mirrors migration 0042's telematics_integrations pattern (encrypted-at-rest per-org vendor
-- credential in Settings > Integrations) plus a new audit table so the load-detail "Post to DAT"
-- action can tell whether a load has already been posted, and to which external posting id.
--
-- Learning from 0042/0043 (telematics shipped without explicit table grants — RLS alone is not
-- reachable without a base-table GRANT; see 0002_tighten_base_grants.sql), this migration includes
-- its own grants up front instead of needing a follow-up fix migration.
--
-- Capability shape is DELIBERATELY different from telematics_integrations: Samsara/Motive vendor
-- credentials are gated behind `subscription_management` (owner/solo only — a pure admin/billing
-- concern). DAT posting is a day-to-day DISPATCH action, so both the credential (API key) and the
-- posting action itself are gated behind a single new `loadboard_posting` capability held by
-- owner/solo/dispatcher (the same three roles that already hold `dispatch`/`loads_manage`) — NOT
-- finance or driver. RLS below mirrors that same role list, so a dispatcher who passes the
-- application-layer capability check is not then blocked by RLS.
--
-- 1) loadboard_integrations -- one row per (carrier_org_id, provider): the org's own DAT API key,
-- entered once in Settings > Integrations. Only 'dat' is supported in Phase 1; the CHECK constraint
-- is written the same way telematics_integrations' provider CHECK is, so adding a second provider
-- later is a one-line change plus a new migration, not a rewrite.
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

COMMENT ON TABLE loadboard_integrations IS
  'One row per (carrier_org_id, provider) load-board vendor credential (Settings > Integrations > Load Board). Credential is app-layer AES-256-GCM encrypted (lib/crypto/secrets.ts), same posture as telematics_integrations -- never plaintext at rest, never returned by any GET route. Phase 1: DAT only, posting-only (no search/booking).';

-- Reached from an ordinary owner/solo/dispatcher session through Settings -- normal RLS policy, not
-- a full REVOKE from authenticated (same posture as telematics_integrations/webhooks).
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

-- 2) loadboard_postings -- append-only audit trail of loads posted to a load board, and the "has
-- this load already been posted to this provider" check the load-detail page's "Post to DAT" button
-- needs. carrier_org_id is denormalized from loads.carrier_org_id (same tradeoff vehicle_locations/
-- webhook_deliveries already make -- migration 0042/0037) so RLS needs no join through loads for
-- every row; the application service (LoadboardPostingService) sets it from the verified actor's own
-- org, never from client input.
CREATE TABLE loadboard_postings (
  id                    BIGSERIAL PRIMARY KEY,
  load_id               BIGINT NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  carrier_org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL CHECK (provider IN ('dat')),
  external_posting_id   TEXT NOT NULL,
  posted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by             UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- One active posting per (load, provider) -- the load-detail button's "already posted" check and
  -- this constraint are the same business rule enforced twice (UI convenience + DB guarantee).
  CONSTRAINT loadboard_postings_load_provider_unique UNIQUE (load_id, provider)
);

CREATE INDEX loadboard_postings_load_id_idx ON loadboard_postings(load_id);
CREATE INDEX loadboard_postings_carrier_org_id_idx ON loadboard_postings(carrier_org_id);

COMMENT ON TABLE loadboard_postings IS
  'Append-only audit trail of loads posted to an external load board (DAT, Phase 1). One row per successful post -- external_posting_id is whatever id the vendor returned (mocked in Phase 1 by MockDatClient). Never updated or deleted by the app.';

ALTER TABLE loadboard_postings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier_loadboard_postings_select" ON loadboard_postings FOR SELECT USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo','dispatcher')
);
CREATE POLICY "carrier_loadboard_postings_insert" ON loadboard_postings FOR INSERT WITH CHECK (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo','dispatcher')
);
-- No UPDATE/DELETE policy -- nothing in the app ever mutates or removes a posting record once
-- written (same posture as vehicle_locations' insert-only design).

REVOKE ALL ON loadboard_postings FROM anon;
GRANT SELECT, INSERT ON loadboard_postings TO authenticated;
GRANT SELECT, INSERT ON loadboard_postings TO service_role;
GRANT USAGE, SELECT ON SEQUENCE loadboard_postings_id_seq TO authenticated, service_role;

-- 3) loadboard_posting capability -- owner/solo/dispatcher only (the same three roles that already
-- hold `dispatch`/`loads_manage`), NOT finance or driver. Gates BOTH managing the DAT credential
-- (Settings > Integrations) and posting a load (load-detail "Post to DAT" button) -- see this
-- migration's header comment for why that differs from telematics_integrations' subscription_management gate.
INSERT INTO role_capabilities (role, capability) VALUES
  ('owner',      'loadboard_posting'),
  ('solo',       'loadboard_posting'),
  ('dispatcher', 'loadboard_posting');

-- 4) loadboard_posting feature gate -- Growth+ (has_feature('loadboard_posting')), same
-- features/has_feature() model as every other gated feature (SECTION 8). display_order 18 is the
-- next available value after support_desk (17, migration 0027).
INSERT INTO features (key, label, min_tier, display_order) VALUES
  ('loadboard_posting', 'DAT Load Board Posting', 'growth', 18);
