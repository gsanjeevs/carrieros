-- Cascaded child deletes run after the organization row has ceased to be
-- visible. Do not try to append activity rows for a tenant that no longer
-- exists; doing so violates tenant_activity_events.org_id and aborts cleanup.
CREATE OR REPLACE FUNCTION capture_tenant_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row JSONB := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_org BIGINT := NULLIF(v_row ->> TG_ARGV[1], '')::BIGINT;
  v_id TEXT := NULLIF(v_row ->> 'id', '');
BEGIN
  IF v_org IS NOT NULL AND EXISTS (SELECT 1 FROM organizations WHERE id = v_org) THEN
    INSERT INTO tenant_activity_events(org_id, actor_user_id, action, aggregate_type, aggregate_id, operation)
    VALUES (v_org, auth.uid(), lower(TG_ARGV[0]) || '.' || lower(TG_OP), TG_ARGV[0], v_id, TG_OP);
  END IF;
  RETURN NULL;
END $$;
