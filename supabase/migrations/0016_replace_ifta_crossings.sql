-- 0016_replace_ifta_crossings.sql
-- "Manual entry overrides GPS entirely for this load" (mockup-20): delete the load's GPS crossings and
-- insert the driver's manual ones. The phone did those as two client writes, and for a DRIVER the delete
-- was silently a no-op: RLS on ifta_state_crossings only lets owner/solo/dispatcher delete (drivers may
-- only INSERT), so the promised override never happened for the people it was written for.
--
-- SECURITY DEFINER because that delete legitimately has to bypass RLS for a driver. Same posture as
-- submit_shipment_milestone (0006): the FUNCTION does not decide who may do this (the application layer
-- checks role, entitlement and that a driver owns the load), but it re-establishes the tenant boundary
-- itself instead of inheriting it: the load must belong to my_org_id(), and every row is written with
-- that org. It validates its own inputs (a 2-letter state, positive miles) as cheap defence in depth.

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
