-- 0026_org_branding.sql
--
-- Enterprise "branding customization" (decisions.md PR1 amendment, 2026-09-21 -- resolves the pricing
-- tier's original undefined "white-label" wording). Scoped deliberately narrow, per that amendment:
-- logo + a small set of overridable brand colors within the EXISTING design-token system, so the
-- product feels like the Enterprise customer's own to their drivers/customers. Explicitly NOT a custom
-- domain, NOT hiding the CarrierOS name, NOT a full re-skin -- narrower than "white-label" implied.
--
-- Logo: organizations.logo_path already exists (decisions.md S10) and is written at onboarding for
-- EVERY tier (app/onboarding/steps/AddLogoStep.tsx) -- invoices and the customer directory already use
-- it, ungated. This migration does NOT duplicate that column. What's new is: (a) two carrier-only color
-- overrides, which have no existing home, and (b) an Enterprise gate on APPLYING the org's logo/colors
-- to the app shell and the public tracking page -- a Starter/Growth/Pro carrier's onboarding logo keeps
-- working exactly as it does today (invoices, customer directory), it just isn't reskinning the app
-- shell or the tracking page the way an Enterprise org's now can.
--
-- Colors live on carrier_details, not organizations, matching where `tier` itself and every other
-- carrier-only SaaS-tenant setting already lives (S1's org/carrier_details split) -- customer-type orgs
-- have no tier and never will.
ALTER TABLE carrier_details
  ADD COLUMN brand_primary_color TEXT CHECK (brand_primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN brand_accent_color  TEXT CHECK (brand_accent_color  ~ '^#[0-9A-Fa-f]{6}$');

COMMENT ON COLUMN carrier_details.brand_primary_color IS
  'Enterprise branding customization (decisions.md PR1 amendment) -- overrides --color-brand-orange for this org''s app shell + public tracking page when has_feature(''branding_customization'') is true. NULL = use the default theme color, same fallback the app already ships with.';
COMMENT ON COLUMN carrier_details.brand_accent_color IS
  'Companion to brand_primary_color -- overrides --color-teal. Same NULL-means-default semantics.';

-- The tier gate itself, same features/has_feature() model as every other gated capability (S11).
-- min_tier = 'enterprise' -- the first feature row to actually use this tier, since nothing Enterprise-
-- specific existed before PR1 was scoped.
INSERT INTO features (key, label, min_tier, display_order) VALUES
  ('branding_customization', 'Branding Customization', 'enterprise', 16);

-- Who may change it: owner/solo only (task brief's explicit scope), same shape as every other
-- org-administration capability (team_manage, drivers_manage, vehicles_manage -- migration 0023).
-- Generated into both apps by scripts/gen-role-capabilities.mjs; nothing hand-rolls this role list.
INSERT INTO role_capabilities (role, capability) VALUES
  ('owner', 'org_branding_manage'),
  ('solo',  'org_branding_manage');

-- Single resolver for the AUTHENTICATED app shell (Rule A's "one resolver, not scattered" principle,
-- architecture-principles.md, applied here to branding tokens rather than status colors). Returns NULLs
-- for every field when the org is not entitled, so lib/branding.ts never needs its own has_feature()
-- check -- the entitlement decision lives in exactly one place, here, reachable from RLS-style contexts
-- the same way has_feature()/get_my_entitlements() already are.
CREATE OR REPLACE FUNCTION get_org_branding()
RETURNS TABLE(enabled BOOLEAN, logo_path TEXT, primary_color TEXT, accent_color TEXT)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    has_feature('branding_customization'),
    CASE WHEN has_feature('branding_customization') THEN o.logo_path ELSE NULL END,
    CASE WHEN has_feature('branding_customization') THEN cd.brand_primary_color ELSE NULL END,
    CASE WHEN has_feature('branding_customization') THEN cd.brand_accent_color ELSE NULL END
  FROM organizations o
  LEFT JOIN carrier_details cd ON cd.org_id = o.id
  WHERE o.id = my_org_id();
$$;
GRANT EXECUTE ON FUNCTION get_org_branding() TO authenticated;

-- The public tracking page (app/track/[token]/page.tsx) has NO auth session, so my_org_id() (which
-- has_feature() depends on) resolves to NULL there -- get_org_branding() above cannot serve it. Extends
-- the existing token-scoped SECURITY DEFINER RPC instead, using entitlement_decision(org_id, key)
-- (migration 0021), the org-id-parameterized primitive has_feature() itself now delegates to -- the
-- SAME "one resolver" entitlement logic, just invoked with an explicit org id instead of my_org_id()
-- since anon has none. Deliberately does not add a general anon SELECT policy on carrier_details for
-- this -- same reasoning get_public_tracking()'s original header comment already gives for organizations.
DROP FUNCTION IF EXISTS get_public_tracking(TEXT);
CREATE FUNCTION get_public_tracking(p_token TEXT)
RETURNS TABLE(
  load_number         TEXT,
  status               TEXT,
  pickup_city          TEXT,
  pickup_state         TEXT,
  delivery_city        TEXT,
  delivery_state       TEXT,
  pickup_date          DATE,
  delivery_date        DATE,
  last_location_lat    NUMERIC,
  last_location_lng    NUMERIC,
  last_location_at     TIMESTAMPTZ,
  carrier_name         TEXT,
  carrier_phone        TEXT,
  carrier_email        TEXT,
  brand_logo_path      TEXT,
  brand_primary_color  TEXT,
  brand_accent_color   TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    l.load_number, l.status,
    l.pickup_city, l.pickup_state, l.delivery_city, l.delivery_state,
    l.pickup_date, l.delivery_date,
    l.last_location_lat, l.last_location_lng, l.last_location_at,
    o.name, o.phone, o.email,
    CASE WHEN (SELECT d.allowed FROM entitlement_decision(o.id, 'branding_customization') d)
         THEN o.logo_path ELSE NULL END,
    CASE WHEN (SELECT d.allowed FROM entitlement_decision(o.id, 'branding_customization') d)
         THEN cd.brand_primary_color ELSE NULL END,
    CASE WHEN (SELECT d.allowed FROM entitlement_decision(o.id, 'branding_customization') d)
         THEN cd.brand_accent_color ELSE NULL END
  FROM loads l
  JOIN organizations o ON o.id = l.carrier_org_id
  LEFT JOIN carrier_details cd ON cd.org_id = o.id
  WHERE l.tracking_token = p_token
$$;

GRANT EXECUTE ON FUNCTION get_public_tracking(TEXT) TO anon;
