-- 0018_driver_load_column_guard.sql
-- Found while moving the mobile app onto the API: the RLS policy driver_loads_update_status lets a driver
-- UPDATE their own load with WITH CHECK (true), i.e. ANY COLUMN. RLS is row-level; it cannot say
-- "status and location only". So a driver with their own JWT could PATCH /rest/v1/loads and rewrite the
-- rate, the customer, the assigned driver, even carrier_org_id. The mobile app never did, but nothing
-- stopped a modified client from doing so.
--
-- A BEFORE UPDATE trigger is the right tool for a column-level rule. It applies ONLY when the caller's
-- role is 'driver' (my_role() is null for service_role/postgres and other roles are unaffected), and it
-- permits exactly what drivers legitimately change: `status` (advancing a shipment, including through
-- submit_shipment_milestone, which runs SECURITY DEFINER but still sees the caller's auth.uid()) and the
-- three live-location columns. updated_at is ignored because another trigger sets it.
--
-- Fires before loads_updated_at (triggers run in name order), so the comparison never sees that write.

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
