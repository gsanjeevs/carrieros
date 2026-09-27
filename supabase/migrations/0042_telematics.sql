-- 0042_telematics.sql
--
-- Real Samsara + Motive telematics integration (user request, 2026-09-26): the dispatch map
-- (app/(app)/dispatch, migration 0041) currently only ever shows a vehicle's position for a load
-- with an active status, sourced from the driver's phone GPS (loads.last_location_lat/lng/
-- last_location_at). There was no way to register a GPS/telematics device with a vehicle at all,
-- and no third-party telematics/ELD integration existed. This migration adds the schema for both:
-- registering a device on a vehicle, storing per-org vendor credentials, and a normalized
-- vehicle_locations table any vendor (or the existing phone-GPS path) can feed, so an idle truck
-- with no active load can still show on the fleet map.
--
-- 1) vehicles.telematics_provider / telematics_device_id -- the registration fields themselves.
-- Nullable: most vehicles will never have one. `telematics_device_id` is intentionally a single
-- opaque TEXT id (not two columns for two vendors) -- Motive registers its `vehicle_id` here (see
-- rationale in app/api/webhooks/telematics/motive/[org_id]/route.ts's header comment), Samsara its
-- vehicle id from the locations feed. One vehicle has at most one active provider at a time.
ALTER TABLE vehicles
  ADD COLUMN telematics_provider  TEXT CHECK (telematics_provider IN ('samsara','motive')),
  ADD COLUMN telematics_device_id TEXT;

COMMENT ON COLUMN vehicles.telematics_provider IS
  'Which telematics/ELD vendor (if any) reports this vehicle''s GPS position. NULL = no telematics device registered (phone-GPS-only, via the existing loads.last_location_* path while a load is active).';
COMMENT ON COLUMN vehicles.telematics_device_id IS
  'The vendor''s own identifier for this vehicle -- Motive''s `vehicle_id` (webhook payload field), Samsara''s vehicle `id` (locations feed). Opaque to this app; only ever compared for equality against inbound vendor payloads. NULL unless telematics_provider is set.';

-- 2) telematics_integrations -- one row per (carrier_org_id, provider): the org's own vendor
-- credential, entered once in Settings > Integrations. Mirrors ai_provider_config's encrypt-at-rest
-- pattern (migration 0032, lib/crypto/secrets.ts's AES-256-GCM encryptSecret()/decryptSecret()) --
-- NOT webhooks.secret's plaintext pattern (migration 0037), because these ARE third-party
-- credentials read back for outbound calls (Samsara's Bearer token) or signature verification
-- (Motive's shared secret), the exact case encrypt-at-rest exists for, unlike webhooks.secret which
-- is this app's OWN outbound-signing secret.
--
-- Only one of api_key_encrypted (Samsara) / webhook_secret_encrypted (Motive) is ever populated for
-- a given row, matching which credential that provider actually needs -- enforced by the CHECK
-- below, not just convention.
CREATE TABLE telematics_integrations (
  id                        BIGSERIAL PRIMARY KEY,
  carrier_org_id            BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider                  TEXT NOT NULL CHECK (provider IN ('samsara','motive')),

  -- Samsara: Bearer token for the vehicle-locations-feed poll (app/api/cron/telematics/samsara-poll).
  api_key_encrypted         TEXT,
  -- Motive: HMAC-SHA1 shared secret used to verify X-KT-Webhook-Signature on inbound webhook pushes
  -- (app/api/webhooks/telematics/motive/[org_id]).
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

COMMENT ON TABLE telematics_integrations IS
  'One row per (carrier_org_id, provider) telematics vendor credential (Settings > Integrations > Telematics). Credentials are app-layer AES-256-GCM encrypted (lib/crypto/secrets.ts), same posture as ai_provider_config (migration 0032) -- never plaintext at rest, never returned by any GET route.';

-- Owner/solo only, same posture as webhooks (migration 0037) and ai_provider_config (0031/0032):
-- a vendor credential is sensitive and dispatchers/finance/drivers have no legitimate reason to see
-- or manage it. Unlike ai_provider_config (service-role only, no session at all), this one IS reached
-- from an ordinary owner/solo session through Settings, same population as webhooks -- so it gets a
-- normal RLS policy, not a full REVOKE from authenticated.
ALTER TABLE telematics_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_solo_telematics_integrations_all" ON telematics_integrations FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
) WITH CHECK (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);
-- The Motive webhook receiver and Samsara poller have no user session (vendor-called / cron-called)
-- and read/write through the service-role admin client, exactly like
-- SupabaseWebhookDeliveryRepository (0037) -- service_role bypasses RLS by default, no extra grant
-- needed for that path.

-- 3) vehicle_locations -- normalized location pings from any telematics source. Distinct from
-- loads.last_location_* (which is load-scoped, phone-GPS-only, and only exists while a load is
-- active): this is vehicle-scoped and exists independent of any load, which is the whole point --
-- an idle truck with no active load can still report a position here.
CREATE TABLE vehicle_locations (
  id              BIGSERIAL PRIMARY KEY,
  vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  -- Denormalized from vehicles.carrier_org_id, same tradeoff load_events/webhook_deliveries make,
  -- so RLS here needs no subquery join through vehicles for every row.
  carrier_org_id  BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  -- The VENDOR's own timestamp for this fix (Motive's `located_at`, Samsara's locations-feed
  -- timestamp) -- never this row's insert time, which can lag a webhook queue or a poll cycle and
  -- would corrupt the map's staleness/precedence logic (app/(app)/dispatch/page.tsx) if conflated
  -- with `created_at`.
  recorded_at     TIMESTAMPTZ NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('samsara','motive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX vehicle_locations_vehicle_id_recorded_at_idx ON vehicle_locations(vehicle_id, recorded_at DESC);
CREATE INDEX vehicle_locations_carrier_org_id_idx ON vehicle_locations(carrier_org_id);

COMMENT ON TABLE vehicle_locations IS
  'Normalized telematics location pings, vehicle-scoped (not load-scoped) -- lets an idle vehicle with no active load still show a live position on the dispatch map, unlike loads.last_location_* which only exists for the duration of an active load.';
COMMENT ON COLUMN vehicle_locations.recorded_at IS
  'The vendor''s own fix timestamp (Motive located_at / Samsara locations-feed time), not this row''s insert time -- used for staleness display and for precedence against loads.last_location_at.';

ALTER TABLE vehicle_locations ENABLE ROW LEVEL SECURITY;
-- Same read population as loads/vehicles (carrier_vehicles_select-style): owner/solo/dispatcher, any
-- role that isn't specifically excluded -- mirrors carrier_vehicles_select's shape exactly (no
-- role restriction beyond org match), since a location ping is no more sensitive than the vehicle
-- row it belongs to.
CREATE POLICY "carrier_vehicle_locations_select" ON vehicle_locations FOR SELECT USING (
  carrier_org_id = my_org_id()
);
-- All writes come from the service-role admin client (Motive webhook receiver, Samsara poller) --
-- neither has a user session, so no authenticated-role INSERT policy is needed, same posture as
-- webhook_deliveries (0037): read-only from the RLS-scoped client, all writes via service_role.

-- 4) Realtime: add vehicle_locations to supabase_realtime so DispatchMapClient.tsx's Postgres
-- Changes subscription can also merge INSERT/UPDATE events for idle-truck pins, same live-map
-- mechanism migration 0041 wired up for `loads`. Same defensive
-- CREATE-PUBLICATION-IF-NOT-EXISTS guard as 0041 -- verify-migrations.mjs's from-scratch-Postgres
-- checks have no Supabase platform bootstrap to assume the publication already exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_locations;
