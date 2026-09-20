-- 0017_submit_dvir_inspection.sql
-- A DVIR is an inspection PLUS its defects. The phone inserted the inspection, then later inserted
-- the defects as a separate call, so a failure in between left an inspection marked 'defects_noted'
-- with no defects recorded (a safety record that lies). One transaction: both rows or neither.
--
-- SECURITY INVOKER: both inserts run as the CALLER, so RLS still decides who may file one
-- (dvir_inspections: driver INSERT only with their own driver_id; owner/solo ALL; dvir_defects likewise).
-- The org comes from the session (my_org_id()); the load must belong to it, or nothing is written.
-- p_driver_id is supplied by the application layer, and RLS refuses it unless it is the caller's own.

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
