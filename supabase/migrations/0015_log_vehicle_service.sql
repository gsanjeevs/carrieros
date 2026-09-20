-- 0015_log_vehicle_service.sql
-- Logging a service used to be two client writes: insert the service_logs row, then update
-- the maintenance reminder it satisfies. A failure between them left a logged service whose
-- reminder still said "overdue". One transaction fixes that.
--
-- SECURITY INVOKER: both writes run AS THE CALLER, so RLS on service_logs and
-- maintenance_reminders (owner/solo) still decides who may do it. The org and the logger
-- come from the session (my_org_id(), auth.uid()), never from arguments, so a caller cannot
-- log against another tenant's vehicle: the vehicle must belong to their org or nothing is written.

CREATE OR REPLACE FUNCTION log_vehicle_service(
  p_vehicle_id      BIGINT,
  p_service_type    TEXT,
  p_service_date    DATE,
  p_odometer        INTEGER,
  p_cost            NUMERIC,
  p_shop_name       TEXT,
  p_notes           TEXT,
  p_reminder_id     BIGINT,
  p_next_due_date   DATE,
  p_next_due_miles  INTEGER
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org BIGINT := my_org_id();
  v_log_id BIGINT;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_vehicle_id AND carrier_org_id = v_org) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
  END IF;

  INSERT INTO service_logs (vehicle_id, carrier_org_id, service_type, service_date, odometer, cost, shop_name, notes, logged_by)
  VALUES (p_vehicle_id, v_org, p_service_type, p_service_date, p_odometer, p_cost, p_shop_name, p_notes, auth.uid())
  RETURNING id INTO v_log_id;

  IF p_reminder_id IS NOT NULL THEN
    UPDATE maintenance_reminders
       SET last_service_date = p_service_date,
           last_odometer     = p_odometer,
           next_due_date     = p_next_due_date,
           next_due_miles    = p_next_due_miles
     WHERE id = p_reminder_id AND vehicle_id = p_vehicle_id AND carrier_org_id = v_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';  -- rolls the log insert back too
    END IF;
  END IF;

  RETURN v_log_id;
END $$;

REVOKE EXECUTE ON FUNCTION log_vehicle_service(BIGINT, TEXT, DATE, INTEGER, NUMERIC, TEXT, TEXT, BIGINT, DATE, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION log_vehicle_service(BIGINT, TEXT, DATE, INTEGER, NUMERIC, TEXT, TEXT, BIGINT, DATE, INTEGER) TO authenticated;
