-- 0041_realtime_publication.sql
--
-- Adds `loads` and `driver_messages` to the `supabase_realtime` publication.
-- Real finding while building the live dispatch map (user request, 2026-09-26):
-- neither table was ever added to this publication (`select * from
-- pg_publication_tables where pubname = 'supabase_realtime'` returned zero
-- rows on this environment) -- meaning every Postgres Changes subscription
-- already written against them (components/DriverMessageThread.tsx,
-- carrieros-mobile/src/components/driver-chat-section.tsx's
-- `driver-messages-load-{id}` channel, both listening for INSERT on
-- driver_messages) has silently never received a single event. Those
-- features have been working only via their own initial-fetch-on-mount path,
-- never their "advertised" live-update path. Not caught earlier because a
-- missing publication entry produces no error anywhere -- the subscribe()
-- call succeeds, it just never delivers anything.
--
-- `loads` is added here for the new dispatch-map live-location feature
-- (app/(app)/dispatch/DispatchMapClient.tsx): subscribing to UPDATE events
-- filtered by carrier_org_id so last_location_lat/lng/last_location_at
-- changes move pins without a page reload. RLS still applies to Realtime
-- payloads exactly as it does to normal queries (same posture already
-- documented for driver_messages in DriverMessageThread.tsx's own comments) --
-- a dispatcher only ever receives rows their own dispatcher_loads_select
-- policy would already let them SELECT.
-- On a real Supabase project (hosted or local `supabase start`), this
-- publication always already exists as part of Supabase's own platform
-- bootstrap -- but scripts/db/verify-migrations.mjs's "clean database built
-- from migrations alone" checks run against a bare Postgres with no such
-- bootstrap, so this migration must not assume it exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE loads;
ALTER PUBLICATION supabase_realtime ADD TABLE driver_messages;
