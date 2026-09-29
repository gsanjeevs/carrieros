-- 0061_platform_flag_kill_switch_precedence.sql
-- Impact: platform_flags/org_flag_overrides are the global operational gate used by entitlement_decision().
-- A tenant override must never re-enable a capability while the global kill switch is off. Seed controls for
-- every registered capability so the admin console has real, understandable controls on existing databases.
-- Rollback: restore the prior entitlement_decision() flag lookup and delete only newly seeded rows if unused.

INSERT INTO public.platform_flags (flag_key, description, default_enabled)
SELECT f.key,
       format('Operational rollout/kill switch for %s. Does not grant access above the organization plan.', f.label),
       true
  FROM public.features f
ON CONFLICT (flag_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.entitlement_decision(p_org_id BIGINT, p_key TEXT)
RETURNS TABLE(allowed BOOLEAN, reason TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_global_flag_on BOOLEAN;
  v_org_flag_on    BOOLEAN;
  v_feature        features%ROWTYPE;
  v_cd             carrier_details%ROWTYPE;
  v_now            TIMESTAMPTZ := now();
BEGIN
  SELECT pf.default_enabled, o.enabled
    INTO v_global_flag_on, v_org_flag_on
    FROM platform_flags pf
    LEFT JOIN org_flag_overrides o ON o.flag_key = pf.flag_key AND o.org_id = p_org_id
   WHERE pf.flag_key = p_key;
  IF FOUND AND NOT v_global_flag_on THEN
    RETURN QUERY SELECT false, 'DISABLED_BY_PLATFORM_FLAG'; RETURN;
  END IF;
  IF FOUND AND v_org_flag_on IS FALSE THEN
    RETURN QUERY SELECT false, 'DISABLED_BY_ORG_FLAG'; RETURN;
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

REVOKE EXECUTE ON FUNCTION public.entitlement_decision(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entitlement_decision(BIGINT, TEXT) TO service_role;
