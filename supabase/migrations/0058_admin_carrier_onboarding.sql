CREATE TABLE admin_carrier_onboarding (
  org_id BIGINT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  contact_name TEXT NOT NULL CHECK (char_length(trim(contact_name)) BETWEEN 1 AND 120),
  contact_email TEXT NOT NULL CHECK (char_length(trim(contact_email)) BETWEEN 3 AND 254),
  stage TEXT NOT NULL DEFAULT 'intake' CHECK (stage IN ('intake','setup','training','launch_ready','live','blocked')),
  next_action TEXT,
  next_follow_up_at TIMESTAMPTZ,
  blocker_note TEXT,
  owner_invite_sent_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_carrier_onboarding_stage_followup ON admin_carrier_onboarding(stage, next_follow_up_at);
CREATE TRIGGER admin_carrier_onboarding_updated_at
  BEFORE UPDATE ON admin_carrier_onboarding FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE admin_carrier_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_carrier_onboarding FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON admin_carrier_onboarding TO service_role;

CREATE OR REPLACE FUNCTION admin_create_carrier_onboarding(
  p_company_name TEXT,
  p_contact_name TEXT,
  p_contact_email TEXT,
  p_tier TEXT,
  p_country TEXT,
  p_created_by UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id BIGINT;
  v_currency TEXT;
BEGIN
  IF char_length(trim(p_company_name)) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'Company name must be between 2 and 160 characters';
  END IF;
  IF char_length(trim(p_contact_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Contact name must be between 1 and 120 characters';
  END IF;
  IF p_contact_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'A valid contact email is required';
  END IF;
  IF p_tier IS NULL OR p_tier NOT IN ('starter','growth','pro','enterprise') THEN
    RAISE EXCEPTION 'Invalid carrier plan';
  END IF;
  IF p_country IS NULL OR p_country NOT IN ('US','CA','MX') THEN
    RAISE EXCEPTION 'Invalid country';
  END IF;

  v_currency := CASE p_country WHEN 'CA' THEN 'CAD' WHEN 'MX' THEN 'MXN' ELSE 'USD' END;
  INSERT INTO organizations(type, name, email, country, currency)
    VALUES ('carrier', trim(p_company_name), lower(trim(p_contact_email)), p_country, v_currency)
    RETURNING id INTO v_org_id;
  INSERT INTO carrier_details(org_id, tier, billing_status)
    VALUES (v_org_id, p_tier, 'trialing');
  INSERT INTO admin_carrier_onboarding(org_id, contact_name, contact_email, created_by)
    VALUES (v_org_id, trim(p_contact_name), lower(trim(p_contact_email)), p_created_by);
  INSERT INTO admin_events(org_id, admin_id, event_type, metadata)
    VALUES (v_org_id, p_created_by, 'admin.carrier_onboarding_started', jsonb_build_object('tier', p_tier, 'country', p_country));
  RETURN v_org_id;
END $$;

REVOKE ALL ON FUNCTION admin_create_carrier_onboarding(TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_create_carrier_onboarding(TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;
