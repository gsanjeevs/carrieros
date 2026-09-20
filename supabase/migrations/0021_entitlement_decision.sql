-- 0021_entitlement_decision.sql
-- Server-side tier enforcement (2026-09-20 tier audit). has_feature()/get_my_entitlements() compared tier rank and
-- nothing else, so a canceled, unpaid or expired-trial carrier kept every feature, the admin's per-org flags and
-- kill switches were stored but read by nothing, and several gates existed only in API routes (a direct PostgREST
-- write skipped them). The evaluation rules already exist as a tested pure function,
-- server/domain/entitlement/model.ts (decideEntitlement); this is the same ordered rule set in SQL so that
-- RLS and RPCs, not just routes, can rely on it. tests/entitlement-parity.test.ts runs the same scenarios through
-- both and fails if they diverge.
--
-- Order (identical to the domain model):
--   1 platform flag with the feature's key, resolved per org (override, else default)  2 feature exists
--   3 org is a carrier   4 active deny override   5 subscription standing (canceled / expired trial / past_due
--   past its grace)   6 ...unless the feature is retained_when_delinquent   7 active grant override   8 tier rank.
--
-- has_feature() now returns false, never NULL, for non-carrier orgs and unknown keys.

ALTER TABLE features ADD COLUMN retained_when_delinquent BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN features.retained_when_delinquent IS
  'Survives trial expiry / cancellation / past_due: things a customer needs in order to pay or export their data.';

-- Per-org, per-feature grant or deny, set by ShipmentX staff through the admin API. Server-only: no client role
-- can read or write it (same posture as change_events).
CREATE TABLE org_feature_overrides (
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature_key TEXT   NOT NULL REFERENCES features(key) ON DELETE CASCADE,
  effect      TEXT   NOT NULL CHECK (effect IN ('grant', 'deny')),
  reason      TEXT   NOT NULL,
  expires_at  TIMESTAMPTZ,
  set_by      UUID REFERENCES profiles(id),
  set_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, feature_key)
);
ALTER TABLE org_feature_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_feature_overrides FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_feature_overrides TO service_role;

-- The decision. Internal: takes an org id, so it is callable only by the server (service_role) and by the
-- SECURITY DEFINER wrappers below, never by a client with someone else's org id.
CREATE OR REPLACE FUNCTION entitlement_decision(p_org_id BIGINT, p_key TEXT)
RETURNS TABLE(allowed BOOLEAN, reason TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_flag_on   BOOLEAN;
  v_feature   features%ROWTYPE;
  v_cd        carrier_details%ROWTYPE;
  v_now       TIMESTAMPTZ := now();
BEGIN
  SELECT COALESCE(o.enabled, pf.default_enabled) INTO v_flag_on
    FROM platform_flags pf
    LEFT JOIN org_flag_overrides o ON o.flag_key = pf.flag_key AND o.org_id = p_org_id
   WHERE pf.flag_key = p_key;
  IF FOUND AND NOT v_flag_on THEN
    RETURN QUERY SELECT false, 'DISABLED_BY_PLATFORM_FLAG'; RETURN;
  END IF;

  SELECT * INTO v_feature FROM features WHERE key = p_key;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'UNKNOWN_CAPABILITY'; RETURN; END IF;

  SELECT * INTO v_cd FROM carrier_details WHERE org_id = p_org_id;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'NOT_A_CARRIER_ORG'; RETURN; END IF;

  IF EXISTS (SELECT 1 FROM org_feature_overrides
              WHERE org_id = p_org_id AND feature_key = p_key AND effect = 'deny'
                AND (expires_at IS NULL OR expires_at > v_now)) THEN
    RETURN QUERY SELECT false, 'DENIED_BY_OVERRIDE'; RETURN;
  END IF;

  -- Subscription standing. past_due with no grace set still works: the operator has a lever and hasn't pulled it.
  IF v_cd.billing_status = 'canceled' THEN
    IF v_feature.retained_when_delinquent THEN RETURN QUERY SELECT true, 'RETAINED_WHILE_DELINQUENT'; RETURN; END IF;
    RETURN QUERY SELECT false, 'SUBSCRIPTION_CANCELED'; RETURN;
  ELSIF v_cd.billing_status = 'trialing' AND v_cd.trial_ends_at IS NOT NULL AND v_cd.trial_ends_at <= v_now
        AND NOT (v_cd.grace_period_until IS NOT NULL AND v_cd.grace_period_until > v_now) THEN
    IF v_feature.retained_when_delinquent THEN RETURN QUERY SELECT true, 'RETAINED_WHILE_DELINQUENT'; RETURN; END IF;
    RETURN QUERY SELECT false, 'TRIAL_EXPIRED'; RETURN;
  ELSIF v_cd.billing_status = 'past_due' AND v_cd.grace_period_until IS NOT NULL AND v_cd.grace_period_until <= v_now THEN
    IF v_feature.retained_when_delinquent THEN RETURN QUERY SELECT true, 'RETAINED_WHILE_DELINQUENT'; RETURN; END IF;
    RETURN QUERY SELECT false, 'PAST_DUE_GRACE_EXPIRED'; RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM org_feature_overrides
              WHERE org_id = p_org_id AND feature_key = p_key AND effect = 'grant'
                AND (expires_at IS NULL OR expires_at > v_now)) THEN
    RETURN QUERY SELECT true, 'GRANTED_BY_OVERRIDE'; RETURN;
  END IF;

  IF (SELECT rank FROM tiers WHERE code = v_cd.tier) >= (SELECT rank FROM tiers WHERE code = v_feature.min_tier) THEN
    RETURN QUERY SELECT true, CASE
      WHEN v_cd.billing_status = 'trialing' THEN
        CASE WHEN v_cd.trial_ends_at IS NOT NULL AND v_cd.trial_ends_at <= v_now THEN 'WITHIN_GRACE_PERIOD' ELSE 'WITHIN_TRIAL' END
      WHEN v_cd.billing_status = 'past_due' THEN 'WITHIN_GRACE_PERIOD'
      ELSE 'INCLUDED_IN_TIER' END;
    RETURN;
  END IF;
  RETURN QUERY SELECT false, 'TIER_TOO_LOW';
END $$;
REVOKE EXECUTE ON FUNCTION entitlement_decision(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlement_decision(BIGINT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION has_feature(feature_key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT d.allowed FROM entitlement_decision(my_org_id(), feature_key) d), false);
$$;

CREATE OR REPLACE FUNCTION get_my_entitlements()
RETURNS TABLE(key TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.key FROM features f WHERE (SELECT d.allowed FROM entitlement_decision(my_org_id(), f.key) d);
$$;

-- Why a capability is unavailable, so a client can say "your trial ended" instead of a bare false.
CREATE OR REPLACE FUNCTION get_my_entitlement(p_key TEXT)
RETURNS TABLE(allowed BOOLEAN, reason TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.allowed, d.reason FROM entitlement_decision(my_org_id(), p_key) d;
$$;
REVOKE EXECUTE ON FUNCTION get_my_entitlement(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_my_entitlement(TEXT) TO authenticated;

-- Write gates in the database, so a direct PostgREST call cannot skip what the API routes enforce. RESTRICTIVE
-- policies are ANDed with the existing permissive ones (no rewrite). Writes only: after a downgrade or lapse the
-- carrier can still READ what they already recorded, which is the behaviour a customer expects.
CREATE POLICY "tier_gate_driver_chat"       ON driver_messages    AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (has_feature('driver_chat'));
CREATE POLICY "tier_gate_settlements"       ON driver_settlements AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (has_feature('driver_settlements'));
CREATE POLICY "tier_gate_ifta_crossings"    ON ifta_state_crossings AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (has_feature('ifta_mileage_log'));
CREATE POLICY "tier_gate_load_expenses_ins" ON load_expenses      AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (has_feature('load_expenses'));
CREATE POLICY "tier_gate_load_expenses_upd" ON load_expenses      AS RESTRICTIVE FOR UPDATE TO authenticated USING (has_feature('load_expenses')) WITH CHECK (has_feature('load_expenses'));

-- SECURITY DEFINER paths bypass RLS, so they carry the check themselves. PT402 -> HTTP 402.
CREATE OR REPLACE FUNCTION replace_ifta_crossings_with_manual(
  p_load_id BIGINT,
  p_rows    JSONB
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

  IF NOT has_feature('ifta_mileage_log') THEN
    RAISE EXCEPTION 'TIER_UPGRADE_REQUIRED' USING ERRCODE = 'PT402';
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
    RAISE EXCEPTION 'VALIDATION: no valid rows' USING ERRCODE = 'PT400';
  END IF;
  RETURN v_count;
END $$;

-- The three read RPCs that were "enforced at the page level" now answer nothing below their tier.
CREATE OR REPLACE FUNCTION get_ifta_quarterly_summary(p_carrier_org_id BIGINT, p_quarter TEXT)
RETURNS TABLE(state TEXT, total_miles NUMERIC) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.state, SUM(c.odometer_est)::NUMERIC
  FROM ifta_state_crossings c
  WHERE c.carrier_org_id = p_carrier_org_id
    AND p_carrier_org_id = my_org_id()
    AND has_feature('ifta_mileage_log')
    AND to_char(c.crossed_at, '"Q"Q') = split_part(p_quarter, '-', 2)
    AND to_char(c.crossed_at, 'YYYY') = split_part(p_quarter, '-', 1)
  GROUP BY c.state;
$$;

CREATE OR REPLACE FUNCTION get_ifta_tax_summary(p_carrier_org_id BIGINT, p_quarter TEXT)
RETURNS TABLE(state TEXT, miles_in_state NUMERIC, net_tax_due NUMERIC) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_miles NUMERIC;
  v_total_fuel  NUMERIC;
BEGIN
  IF p_carrier_org_id != my_org_id() OR NOT has_feature('ifta_tax_hub') THEN
    RETURN;
  END IF;

  SELECT SUM(c.odometer_est) INTO v_total_miles
  FROM ifta_state_crossings c WHERE c.carrier_org_id = p_carrier_org_id;

  SELECT SUM(f.gallons) INTO v_total_fuel
  FROM fuel_stops f WHERE f.carrier_org_id = p_carrier_org_id;

  RETURN QUERY
  SELECT
    c.state,
    SUM(c.odometer_est)::NUMERIC AS miles_in_state,
    (
      (SUM(c.odometer_est) / NULLIF(v_total_miles, 0)) * COALESCE(v_total_fuel, 0) *
        COALESCE((SELECT rate_per_gallon FROM ifta_tax_rates WHERE ifta_tax_rates.state = c.state AND quarter = p_quarter), 0)
      -
      COALESCE((SELECT SUM(f2.gallons) FROM fuel_stops f2 WHERE f2.carrier_org_id = p_carrier_org_id AND f2.state = c.state), 0)
        * COALESCE((SELECT rate_per_gallon FROM ifta_tax_rates WHERE ifta_tax_rates.state = c.state AND quarter = p_quarter), 0)
    )::NUMERIC AS net_tax_due
  FROM ifta_state_crossings c
  WHERE c.carrier_org_id = p_carrier_org_id
  GROUP BY c.state;
END;
$$;

CREATE OR REPLACE FUNCTION get_customer_health_score(customer_org_id BIGINT)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_paid_total   INT;
  v_paid_on_time INT;
  v_payment_pct  NUMERIC;
  v_exception_ct INT;
  v_exception_pct NUMERIC;
BEGIN
  IF NOT has_feature('customer_health_score') THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE due_date IS NOT NULL),
    COUNT(*) FILTER (WHERE due_date IS NOT NULL AND paid_at IS NOT NULL AND paid_at::DATE <= due_date)
  INTO v_paid_total, v_paid_on_time
  FROM invoices
  WHERE invoices.customer_org_id = get_customer_health_score.customer_org_id
    AND carrier_org_id = my_org_id()
    AND status = 'paid';

  v_payment_pct := CASE WHEN v_paid_total > 0
    THEN (v_paid_on_time::NUMERIC / v_paid_total) * 100
    ELSE 100
  END;

  SELECT COUNT(*)
  INTO v_exception_ct
  FROM exception_events
  WHERE exception_events.entity_type = 'customer'
    AND exception_events.entity_id = get_customer_health_score.customer_org_id
    AND carrier_org_id = my_org_id()
    AND occurred_at >= now() - INTERVAL '90 days';

  v_exception_pct := GREATEST(0, 100 - (LEAST(v_exception_ct, 10) * 10));

  RETURN ROUND((v_payment_pct * 0.7) + (v_exception_pct * 0.3));
END;
$$;
