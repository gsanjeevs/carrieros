-- 0019_close_privilege_escalation_paths.sql
-- Findings from the 2026-09-20 roles/tenancy audit (black-box probes against the running app and DB).
-- Each item below was reproduced before being fixed; the probes live in carrieros-web/tests/audit/.
--
--  1. Anyone signed in could INSERT their own profiles row with ANY org_id and role (own_profile_insert
--     only checked id = auth.uid()) -> owner of any org, or sx_owner platform staff.
--  2. Anyone signed in could INSERT organizations / carrier_details rows directly.
--  3. An owner could UPDATE carrier_details (tier, billing_status, trial_ends_at, stripe ids) with their own
--     JWT: a free, unaudited upgrade. The same class of hole 0018 closed for drivers on loads.
--  4. submit_shipment_milestone / replace_ifta_crossings_with_manual are SECURITY DEFINER and checked only
--     the tenant, not who the caller is, so a driver could act on a coworker's load and finance could change
--     any load's status, bypassing the application-layer authorizeLoadAction.
--  5. A driver could write driver_messages rows with a foreign carrier_org_id or another user's sender_id.
--  6. check_ifta_completeness was callable by anon and answered for any tenant's load.
--  7. loads.driver_id / vehicle_id / customer_org_id and customer_contacts.org_id accepted another tenant's
--     ids, which let a carrier put a foreign driver on a load (leaking the rate) or mint a portal login
--     inside a victim org.
--
-- Every legitimate writer of the tables in 1-3 already uses the service-role client (onboarding, invites,
-- the /api/admin routes), which bypasses RLS and grants, so removing the client-side paths breaks nothing.

-- 1-2. No client-side creation of tenants or profiles.
DROP POLICY IF EXISTS "own_profile_insert" ON profiles;
DROP POLICY IF EXISTS "auth_user_create_carrier_org" ON organizations;
DROP POLICY IF EXISTS "auth_user_create_carrier_details" ON carrier_details;

-- 3. carrier_details is read-only to clients. Subscription state is written only by the server (admin
--    routes now, the billing provider's webhook later). The policy is dropped as well as the privilege so a
--    future blanket GRANT cannot silently re-open it.
DROP POLICY IF EXISTS "owner_solo_carrier_update" ON carrier_details;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON carrier_details FROM anon, authenticated;

-- 4. Who may act on a load, decided once in the database for every SECURITY DEFINER command.
--    Mirrors authorizeLoadAction: owner/solo/dispatcher act on their org's loads, a driver only on a load
--    assigned to them. Everyone else (finance, portal, sx_*) is refused. Not-yours and missing look alike.
CREATE OR REPLACE FUNCTION caller_may_act_on_load(p_load_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE my_role()
    WHEN 'driver' THEN EXISTS (
      SELECT 1 FROM loads l JOIN drivers d ON d.id = l.driver_id
       WHERE l.id = p_load_id AND l.carrier_org_id = my_org_id() AND d.profile_id = auth.uid())
    WHEN 'owner' THEN EXISTS (SELECT 1 FROM loads WHERE id = p_load_id AND carrier_org_id = my_org_id())
    WHEN 'solo' THEN EXISTS (SELECT 1 FROM loads WHERE id = p_load_id AND carrier_org_id = my_org_id())
    WHEN 'dispatcher' THEN EXISTS (SELECT 1 FROM loads WHERE id = p_load_id AND carrier_org_id = my_org_id())
    ELSE FALSE
  END;
$$;
REVOKE EXECUTE ON FUNCTION caller_may_act_on_load(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION caller_may_act_on_load(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION submit_shipment_milestone(
  p_load_id          BIGINT,
  p_expected_status  TEXT,
  p_new_status       TEXT,
  p_event_type       TEXT,
  p_reason           TEXT,
  p_correlation_id   TEXT,
  p_idempotency_key  TEXT,
  p_occurred_at      TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     BIGINT;
  v_actor      UUID;
  v_updated    INTEGER;
  v_load       RECORD;
  v_existing   BIGINT;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  IF NOT caller_may_act_on_load(p_load_id) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, status, load_number INTO v_load FROM loads WHERE id = p_load_id;
    RETURN jsonb_build_object(
      'outcome',     'REPLAYED',
      'load_id',     p_load_id,
      'status',      v_load.status,
      'load_number', v_load.load_number
    );
  END IF;

  UPDATE loads
     SET status = p_new_status
   WHERE id = p_load_id
     AND carrier_org_id = v_org_id
     AND status = p_expected_status;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    SELECT id, status, carrier_org_id INTO v_load FROM loads WHERE id = p_load_id;
    IF NOT FOUND OR v_load.carrier_org_id <> v_org_id THEN
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
    END IF;
    RAISE EXCEPTION 'VERSION_CONFLICT:%', v_load.status USING ERRCODE = 'PT409';
  END IF;

  SELECT id, status, load_number, driver_id INTO v_load FROM loads WHERE id = p_load_id;

  INSERT INTO load_events (load_id, event_type, note, created_by)
  VALUES (p_load_id, p_event_type, p_reason, v_actor);

  INSERT INTO outbox_events (
    event_type, aggregate_type, aggregate_id, org_id,
    payload, correlation_id, idempotency_key
  ) VALUES (
    'MilestoneSubmitted', 'Shipment', p_load_id::TEXT, v_org_id,
    jsonb_build_object(
      'loadId',      p_load_id,
      'loadNumber',  v_load.load_number,
      'priorStatus', p_expected_status,
      'newStatus',   p_new_status,
      'driverId',    v_load.driver_id,
      'occurredAt',  p_occurred_at
    ),
    p_correlation_id, p_idempotency_key
  );

  INSERT INTO audit_events (
    org_id, actor_user_id, action, aggregate_type, aggregate_id,
    prior_state, new_state, reason, correlation_id, occurred_at
  ) VALUES (
    v_org_id, v_actor, 'shipment.milestone.submitted', 'Shipment', p_load_id::TEXT,
    p_expected_status, p_new_status, p_reason, p_correlation_id, p_occurred_at
  );

  RETURN jsonb_build_object(
    'outcome',     'APPLIED',
    'load_id',     p_load_id,
    'status',      v_load.status,
    'load_number', v_load.load_number
  );
END $$;

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

  IF NOT caller_may_act_on_load(p_load_id) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
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

-- 5. A driver's chat rows must belong to their own org and be sent by them.
DROP POLICY IF EXISTS "driver_own_thread_messages" ON driver_messages;
CREATE POLICY "driver_own_thread_messages" ON driver_messages FOR ALL TO authenticated USING (
  carrier_org_id = my_org_id()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid()))
) WITH CHECK (
  carrier_org_id = my_org_id()
  AND sender_id = auth.uid()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid()))
);

-- 6. No anon access, and no cross-tenant answers: a foreign or missing load both read as "no data".
CREATE OR REPLACE FUNCTION check_ifta_completeness(p_load_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT SUM(odometer_est) FROM ifta_state_crossings WHERE load_id = p_load_id AND carrier_org_id = my_org_id()), 0
  ) >= 0.6 * COALESCE((SELECT total_miles FROM loads WHERE id = p_load_id AND carrier_org_id = my_org_id()), 0);
$$;
REVOKE EXECUTE ON FUNCTION check_ifta_completeness(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION check_ifta_completeness(BIGINT) TO authenticated;

-- 7. Tenant guards on foreign keys that RLS cannot express (RLS checks the row being written, not what
--    its ids point at). Applies to every caller including service_role: the data must be consistent.
CREATE OR REPLACE FUNCTION enforce_load_reference_tenancy() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.driver_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.driver_id IS DISTINCT FROM OLD.driver_id)
     AND NOT EXISTS (SELECT 1 FROM drivers WHERE id = NEW.driver_id AND carrier_org_id = NEW.carrier_org_id) THEN
    RAISE EXCEPTION 'driver does not belong to this carrier' USING ERRCODE = '23514';
  END IF;
  IF NEW.vehicle_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id)
     AND NOT EXISTS (SELECT 1 FROM vehicles WHERE id = NEW.vehicle_id AND carrier_org_id = NEW.carrier_org_id) THEN
    RAISE EXCEPTION 'vehicle does not belong to this carrier' USING ERRCODE = '23514';
  END IF;
  IF NEW.customer_org_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.customer_org_id IS DISTINCT FROM OLD.customer_org_id)
     AND NOT EXISTS (SELECT 1 FROM customer_details WHERE org_id = NEW.customer_org_id AND carrier_org_id = NEW.carrier_org_id) THEN
    RAISE EXCEPTION 'customer does not belong to this carrier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER loads_reference_tenancy BEFORE INSERT OR UPDATE ON loads
  FOR EACH ROW EXECUTE FUNCTION enforce_load_reference_tenancy();

CREATE OR REPLACE FUNCTION enforce_contact_customer_tenancy() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.carrier_org_id IS DISTINCT FROM OLD.carrier_org_id)
     AND NOT EXISTS (SELECT 1 FROM customer_details WHERE org_id = NEW.org_id AND carrier_org_id = NEW.carrier_org_id) THEN
    RAISE EXCEPTION 'customer does not belong to this carrier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER customer_contacts_tenancy BEFORE INSERT OR UPDATE ON customer_contacts
  FOR EACH ROW EXECUTE FUNCTION enforce_contact_customer_tenancy();
