-- 0006_shipment_milestone_command.sql
-- Atomic shipment-milestone command: status change + timeline event + outbox
-- event + audit row, in ONE transaction.
--
-- WHY A DATABASE FUNCTION AT ALL. PostgREST cannot span multiple statements in
-- a single transaction, so a client (or a route handler using the Supabase SDK)
-- physically cannot make these four writes atomic. Today both the mobile screen
-- (src/app/load/[id].tsx:228,238) and the web route (app/api/loads/[id]/route.ts)
-- do the status update and the load_events insert as SEPARATE calls — a failure
-- between them leaves a status change with no timeline entry, silently.
--
-- This is INFRASTRUCTURE, not business logic. The decision — is this transition
-- legal, is the actor permitted, is the org entitled — is already made in
-- TypeScript before this is called (server/domain/shipment/execution-state.ts
-- and the application service). This function makes no judgement about whether
-- a transition *should* happen; it validates its preconditions and persists the
-- result indivisibly. Adding transition rules here would be the mistake.
--
-- SECURITY DEFINER, deliberately, with an explicit tenant check.
-- The function must write outbox_events, which is deny-all to `authenticated`
-- by design (0005). Running as owner is the only way to do that in the same
-- transaction as the tenant's own write. That bypasses RLS, so the tenant
-- boundary is re-established explicitly below instead of being inherited:
-- auth.uid() survives into a DEFINER function (it comes from the request's JWT
-- claims, not the role), so my_org_id() still resolves the CALLER's org, never
-- the owner's. The load is then matched on that org id, so a caller cannot
-- touch another tenant's shipment even though RLS is not in play.
--
-- Defence in depth is preserved: the application policy service checks first,
-- this function checks second, and RLS still governs every other path to the
-- loads table.

CREATE OR REPLACE FUNCTION submit_shipment_milestone(
  p_load_id          BIGINT,
  p_expected_status  TEXT,   -- compare-and-swap precondition
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

  -- Idempotency first. A retried command (mobile on a flaky connection, a
  -- double-tap, a proxy replay) must not produce a second timeline entry or a
  -- second outbox event. outbox_events.idempotency_key is UNIQUE, so this is
  -- belt-and-braces with the constraint rather than a substitute for it.
  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, status, load_number INTO v_load FROM loads WHERE id = p_load_id;
    RETURN jsonb_build_object(
      'outcome',   'REPLAYED',
      'load_id',   p_load_id,
      'status',    v_load.status,
      'load_number', v_load.load_number
    );
  END IF;

  -- Compare-and-swap on the current status. `loads` has no version column and
  -- adding one to a hot table for this is disproportionate: for a state
  -- machine the current state IS the version, and "move from X to Y only if
  -- still at X" is exactly the optimistic check that matters. Two dispatchers
  -- advancing the same load concurrently — the real race — is caught here,
  -- because the second one's expected status no longer matches.
  --
  -- carrier_org_id is matched against my_org_id(), NOT against anything the
  -- caller supplied. This is the tenant boundary.
  UPDATE loads
     SET status = p_new_status
   WHERE id = p_load_id
     AND carrier_org_id = v_org_id
     AND status = p_expected_status;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    -- Distinguish the three ways this legitimately fails, so the API can map
    -- them to different HTTP responses instead of one opaque error.
    SELECT id, status, carrier_org_id INTO v_load FROM loads WHERE id = p_load_id;
    IF NOT FOUND OR v_load.carrier_org_id <> v_org_id THEN
      -- Not found and not-yours are answered identically on purpose: telling a
      -- caller that a load exists but belongs to someone else is itself a
      -- cross-tenant disclosure.
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'VERSION_CONFLICT:%', v_load.status USING ERRCODE = '40001';
  END IF;

  SELECT id, status, load_number, driver_id INTO v_load FROM loads WHERE id = p_load_id;

  -- Timeline event. Same table and same event_type spelling the existing code
  -- writes, so migrated and unmigrated loads render identically in the UI.
  INSERT INTO load_events (load_id, event_type, notes, created_by)
  VALUES (p_load_id, p_event_type, p_reason, v_actor);

  -- Outbox. Committing with the update above is the entire point of this
  -- function.
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

  -- Audit: prior state, new state, reason, actor, scope, time, correlation.
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

COMMENT ON FUNCTION submit_shipment_milestone IS
  'Atomic milestone command: CAS status update + load_events + outbox + audit. Called only by the /api/v1 application service, which owns the transition rules.';

-- Explicit grant. Not left to default PUBLIC — that is exactly the defect
-- migration 0003 closed for two other SECURITY DEFINER functions.
REVOKE EXECUTE ON FUNCTION submit_shipment_milestone(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_shipment_milestone(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO authenticated;
