-- 0049_customer_tracking_exceptions.sql
-- Let carrier dispatchers explicitly publish a sanitized shipment exception update to a token-scoped tracking page.
-- Internal exception titles/details, driver identity, and load-event notes remain private.

ALTER TABLE exception_events
  ADD COLUMN customer_visible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN customer_message TEXT;

ALTER TABLE exception_events
  ADD CONSTRAINT exception_events_customer_message_length
  CHECK (customer_message IS NULL OR char_length(customer_message) BETWEEN 1 AND 280);

CREATE OR REPLACE FUNCTION set_tracking_exception_visibility(
  p_exception_id BIGINT,
  p_visible BOOLEAN,
  p_customer_message TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id BIGINT := my_org_id();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF my_role() NOT IN ('owner','solo','dispatcher') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_visible IS NULL OR (p_visible AND (p_customer_message IS NULL OR char_length(btrim(p_customer_message)) NOT BETWEEN 1 AND 280)) THEN
    RAISE EXCEPTION 'VALIDATION: customer message must contain 1 to 280 characters' USING ERRCODE = 'PT400';
  END IF;

  UPDATE exception_events e
     SET customer_visible = p_visible,
         customer_message = CASE WHEN p_visible THEN btrim(p_customer_message) ELSE NULL END
    FROM loads l
   WHERE e.id = p_exception_id
     AND e.carrier_org_id = v_org_id
     AND e.entity_type = 'load'
     AND l.id = e.entity_id
     AND l.carrier_org_id = v_org_id
     AND l.tracking_token IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404'; END IF;
  RETURN p_visible;
END;
$$;
REVOKE ALL ON FUNCTION set_tracking_exception_visibility(BIGINT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_tracking_exception_visibility(BIGINT, BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION get_public_tracking_exceptions(p_token TEXT)
RETURNS TABLE(customer_message TEXT, severity TEXT, occurred_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT e.customer_message, e.severity, e.occurred_at
    FROM exception_events e
    JOIN loads l ON l.id = e.entity_id AND l.carrier_org_id = e.carrier_org_id
   WHERE l.tracking_token = p_token
     AND e.entity_type = 'load'
     AND e.customer_visible
     AND e.customer_message IS NOT NULL
   ORDER BY e.occurred_at DESC
   LIMIT 20;
$$;
REVOKE ALL ON FUNCTION get_public_tracking_exceptions(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_tracking_exceptions(TEXT) TO anon, authenticated;
