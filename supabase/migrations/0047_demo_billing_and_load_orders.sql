-- 0047_demo_billing_and_load_orders.sql
-- Local/demo plan changes record an explicitly simulated transaction. Also
-- introduce customer-scoped order rows under a dispatch load so consolidated
-- freight can carry multiple customer orders without sharing the order rows.

ALTER TABLE billing_events
  ADD COLUMN payment_reference TEXT UNIQUE,
  ADD COLUMN plan_code TEXT,
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN is_simulated BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION demo_change_plan(
  p_org_id BIGINT,
  p_tier TEXT,
  p_payment_reference TEXT
)
RETURNS TABLE(tier TEXT, amount NUMERIC, currency TEXT, event_id BIGINT, event_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing billing_events%ROWTYPE;
  v_current_tier TEXT;
  v_amount NUMERIC(10,2);
  v_event_id BIGINT;
BEGIN
  IF p_org_id IS NULL OR p_tier IS NULL OR p_payment_reference IS NULL OR length(p_payment_reference) > 200 THEN
    RAISE EXCEPTION 'Invalid plan-change request';
  END IF;

  -- Serializing on the carrier row makes same-key retries deterministic and
  -- prevents two concurrent clicks from recording duplicate demo charges.
  SELECT cd.tier INTO v_current_tier FROM carrier_details cd WHERE cd.org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Carrier billing profile not found'; END IF;

  SELECT * INTO v_existing FROM billing_events WHERE payment_reference = p_payment_reference;
  IF FOUND THEN
    IF v_existing.org_id <> p_org_id OR v_existing.plan_code <> p_tier OR NOT v_existing.is_simulated THEN
      RAISE EXCEPTION 'Payment reference was already used for a different request';
    END IF;
    RETURN QUERY SELECT p_tier, v_existing.amount, v_existing.currency, v_existing.id, COALESCE(v_existing.status, 'simulated_succeeded');
    RETURN;
  END IF;

  SELECT monthly_price INTO v_amount FROM tiers WHERE code = p_tier;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown plan'; END IF;

  IF v_current_tier = p_tier THEN
    RETURN QUERY SELECT p_tier, 0::NUMERIC, 'USD'::TEXT, NULL::BIGINT, 'no_change'::TEXT;
    RETURN;
  END IF;

  -- The plan write and simulated transaction are one database transaction:
  -- neither can succeed without the other. No card or Stripe API is used.
  UPDATE carrier_details SET tier = p_tier, billing_status = 'active', trial_ends_at = NULL
    WHERE org_id = p_org_id;
  INSERT INTO billing_events(org_id, event_type, amount, currency, status, is_simulated, plan_code, payment_reference)
    VALUES (p_org_id, 'demo.subscription.payment_succeeded', v_amount, 'USD', 'simulated_succeeded', TRUE, p_tier, p_payment_reference)
    RETURNING id INTO v_event_id;

  RETURN QUERY SELECT p_tier, v_amount, 'USD'::TEXT, v_event_id, 'simulated_succeeded'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION demo_change_plan(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION demo_change_plan(BIGINT, TEXT, TEXT) TO service_role;

CREATE TABLE load_orders (
  id BIGSERIAL PRIMARY KEY,
  carrier_org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  load_id BIGINT NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  customer_org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  customer_reference TEXT,
  commodity TEXT,
  weight_lbs INT CHECK (weight_lbs IS NULL OR weight_lbs > 0),
  pickup_address TEXT,
  pickup_city TEXT,
  pickup_state TEXT,
  pickup_date DATE,
  delivery_address TEXT,
  delivery_city TEXT,
  delivery_state TEXT,
  delivery_date DATE,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','dispatched','picked_up','in_transit','delivered','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (carrier_org_id, order_number)
);

CREATE INDEX load_orders_load_idx ON load_orders(load_id);
CREATE INDEX load_orders_customer_idx ON load_orders(customer_org_id, load_id);
ALTER TABLE load_orders ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON load_orders TO authenticated;
GRANT ALL ON load_orders TO service_role;
GRANT USAGE, SELECT ON SEQUENCE load_orders_id_seq TO authenticated, service_role;

CREATE POLICY carrier_load_orders_select ON load_orders FOR SELECT TO authenticated USING (
  carrier_org_id = my_org_id() AND (
    my_role() IN ('owner','solo','dispatcher','finance')
    OR (my_role() = 'driver' AND EXISTS (
      SELECT 1 FROM loads l JOIN drivers d ON d.id = l.driver_id
      WHERE l.id = load_orders.load_id AND d.profile_id = auth.uid()
    ))
  )
);
CREATE POLICY carrier_load_orders_insert ON load_orders FOR INSERT TO authenticated WITH CHECK (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')
  AND EXISTS (SELECT 1 FROM loads l WHERE l.id = load_orders.load_id AND l.carrier_org_id = load_orders.carrier_org_id)
  AND EXISTS (SELECT 1 FROM customer_details cd WHERE cd.org_id = load_orders.customer_org_id AND cd.carrier_org_id = load_orders.carrier_org_id)
);
CREATE POLICY carrier_load_orders_update ON load_orders FOR UPDATE TO authenticated
  USING (carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher'))
  WITH CHECK (
    carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')
    AND EXISTS (SELECT 1 FROM loads l WHERE l.id = load_orders.load_id AND l.carrier_org_id = load_orders.carrier_org_id)
    AND EXISTS (SELECT 1 FROM customer_details cd WHERE cd.org_id = load_orders.customer_org_id AND cd.carrier_org_id = load_orders.carrier_org_id)
  );
CREATE POLICY customer_own_load_orders_select ON load_orders FOR SELECT TO authenticated USING (
  customer_org_id = my_org_id() AND my_role() IN ('customer_admin','customer_viewer')
);

CREATE TRIGGER load_orders_updated_at BEFORE UPDATE ON load_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
