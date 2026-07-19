-- Allow any authenticated user to create a carrier organization (onboarding)
CREATE POLICY "auth_user_create_carrier_org" ON organizations
  FOR INSERT WITH CHECK (type = 'carrier' AND auth.uid() IS NOT NULL);

-- Allow any authenticated user to create carrier_details (onboarding)
CREATE POLICY "auth_user_create_carrier_details" ON carrier_details
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Allow profile insert during onboarding (may already exist)
-- Already covered by "own_profile_insert" policy