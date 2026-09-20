-- 0011_milestone_command_http_error_codes.sql
-- Fixes a hang found when the CI/integration suite was first run end-to-end:
-- submit_shipment_milestone raised VERSION_CONFLICT with SQLSTATE 40001
-- (serialization_failure). PostgREST treats 40001 as retryable and, on the
-- pinned v14.14, the request never completes (its connection sits idle right
-- after BEGIN until the client gives up). Reproduced with a bare function that
-- only raises 40001; the same function raising P0001 answers 400 in ~25 ms.
-- So a genuine concurrent-edit conflict -- the exact case the compare-and-swap
-- exists for -- would have hung the API instead of reporting the conflict.
--
-- Custom SQLSTATEs of the form PTnnn are PostgREST's documented way to choose
-- the HTTP status, so the two domain outcomes now map cleanly:
--   PT409 -> 409 Conflict   (VERSION_CONFLICT:<current status>)
--   PT404 -> 404 Not Found  (NOT_FOUND; identical for missing and not-yours, on
--                            purpose -- see 0006 -- previously an opaque 500 via P0002)
-- Messages and the JSON return shape are unchanged. Fixed forward: 0006/0007
-- are applied and checksum-locked. CREATE OR REPLACE keeps 0006's grants.

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
