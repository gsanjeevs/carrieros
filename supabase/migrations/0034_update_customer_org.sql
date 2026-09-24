-- 0034_update_customer_org.sql
-- API-completeness pass (2026-09-24): customer editing never existed before,
-- legacy or v1. A carrier has no direct RLS write access to a customer org's
-- own `organizations` row (owner_solo_org_update only covers `id = my_org_id()`,
-- i.e. your OWN org, not a customer you manage) — so this needs a
-- SECURITY DEFINER function, same shape as create_customer_org() (0001):
-- explicit tenant check via customer_details, since RLS does not apply
-- inside a DEFINER function.
--
-- Updates organizations (identity/contact fields) and customer_details
-- (contact_name/notes) atomically. Every parameter defaults to NULL, but
-- COALESCE against the existing row means "not provided" leaves a field
-- unchanged rather than nulling it out - the caller (server/application)
-- still enforces "at least one field provided" before calling this.
CREATE OR REPLACE FUNCTION update_customer_org(
  p_customer_org_id BIGINT,
  p_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_zip TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_contact_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  -- Explicit "this field was provided" flags -- COALESCE alone can't tell
  -- "caller passed NULL to clear contact_name" apart from "caller omitted
  -- contact_name", and both notes and contact_name are nullable columns a
  -- caller may legitimately want to clear.
  p_set_contact_name BOOLEAN DEFAULT false,
  p_set_notes BOOLEAN DEFAULT false
)
RETURNS TABLE(org_id BIGINT, name TEXT, customer_number TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_org_id  BIGINT := my_org_id();
  v_caller_role    TEXT   := my_role();
  v_customer_number TEXT;
BEGIN
  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'NO_ORGANIZATION';
  END IF;

  IF v_caller_role NOT IN ('owner','solo','dispatcher') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- Tenant check: this customer must belong to the caller's carrier org.
  -- Re-established by hand because SECURITY DEFINER bypasses RLS. Table alias
  -- required: `customer_number` collides with this function's own RETURNS
  -- TABLE column name, which plpgsql cannot otherwise disambiguate.
  SELECT cd.customer_number INTO v_customer_number
  FROM customer_details cd
  WHERE cd.org_id = p_customer_org_id AND cd.carrier_org_id = v_caller_org_id;

  IF v_customer_number IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF p_name IS NOT NULL AND length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: name cannot be blank';
  END IF;

  -- `organizations.name` qualified: bare `name` is ambiguous against this
  -- function's own RETURNS TABLE column of the same name (same issue as the
  -- customer_number lookup above).
  UPDATE organizations SET
    name    = COALESCE(p_name, organizations.name),
    phone   = COALESCE(p_phone, phone),
    email   = COALESCE(p_email, email),
    address = COALESCE(p_address, address),
    city    = COALESCE(p_city, city),
    state   = COALESCE(p_state, state),
    zip     = COALESCE(p_zip, zip),
    country = COALESCE(p_country, country)
  WHERE id = p_customer_org_id;

  -- `org_id` qualified: bare `org_id` is ambiguous against this function's
  -- own RETURNS TABLE column of the same name (same issue throughout this
  -- function — every RETURNS TABLE column name shadows a real table column).
  UPDATE customer_details SET
    contact_name = CASE WHEN p_set_contact_name THEN p_contact_name ELSE contact_name END,
    notes        = CASE WHEN p_set_notes THEN p_notes ELSE notes END
  WHERE customer_details.org_id = p_customer_org_id;

  RETURN QUERY SELECT o.id, o.name, v_customer_number FROM organizations o WHERE o.id = p_customer_org_id;
END;
$$;
