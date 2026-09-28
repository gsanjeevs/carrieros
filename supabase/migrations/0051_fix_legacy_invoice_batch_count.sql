-- 0051_fix_legacy_invoice_batch_count.sql
-- Ensure legacy loads without order rows emit an accurate invoice count in the batch outbox event.
-- Migration 0050 introduced the event but only assigned its count in the multi-order branch.

CREATE OR REPLACE FUNCTION create_load_invoices_command(
  p_load_id             BIGINT,
  p_invoice_rows        JSONB,
  p_due_date            DATE,
  p_payment_method      TEXT,
  p_factoring_company   TEXT,
  p_advance_load_status BOOLEAN,
  p_correlation_id      TEXT,
  p_idempotency_key     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id BIGINT := my_org_id();
  v_actor UUID := auth.uid();
  v_load loads%ROWTYPE;
  v_existing BIGINT;
  v_order_count BIGINT;
  v_allocation_total NUMERIC(10,2);
  v_unallocated BIGINT;
  v_expected_count BIGINT;
  v_input_count BIGINT;
  v_row RECORD;
  v_invoice RECORD;
  v_result JSONB;
BEGIN
  IF v_actor IS NULL OR v_org_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF my_role() NOT IN ('owner','solo','finance') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_payment_method NOT IN ('stripe','factoring','other') OR jsonb_typeof(p_invoice_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'VALIDATION: invalid invoice rows or payment method' USING ERRCODE = 'PT400';
  END IF;

  SELECT * INTO v_load FROM loads WHERE id = p_load_id AND carrier_org_id = v_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404'; END IF;
  IF v_load.status NOT IN ('delivered','invoiced') THEN RAISE EXCEPTION 'LOAD_NOT_DELIVERED' USING ERRCODE = 'PT400'; END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('invoice_id', id, 'invoice_number', invoice_number)
                              ORDER BY customer_org_id), '[]'::JSONB)
      INTO v_result FROM invoices WHERE load_id = p_load_id AND carrier_org_id = v_org_id;
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'invoices', v_result);
  END IF;

  SELECT count(*), sum(billable_amount), count(*) FILTER (WHERE billable_amount IS NULL)
    INTO v_order_count, v_allocation_total, v_unallocated
    FROM load_orders WHERE carrier_org_id = v_org_id AND load_id = p_load_id;
  IF v_order_count > 0 THEN
    IF v_unallocated > 0 OR round(COALESCE(v_allocation_total, 0), 2) <> round(COALESCE(v_load.rate, 0), 2) THEN
      RAISE EXCEPTION 'ORDER_ALLOCATION_MISMATCH' USING ERRCODE = 'PT400';
    END IF;
    SELECT count(*) INTO v_expected_count FROM (
      SELECT o.customer_org_id
        FROM load_orders o
       WHERE o.carrier_org_id = v_org_id AND o.load_id = p_load_id
         AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.load_id = p_load_id AND i.carrier_org_id = v_org_id AND i.customer_org_id = o.customer_org_id)
       GROUP BY o.customer_org_id
    ) expected;
    SELECT count(*) INTO v_input_count FROM jsonb_to_recordset(p_invoice_rows)
      AS r(customer_org_id BIGINT, invoice_number TEXT, amount NUMERIC);
    IF v_input_count <> v_expected_count THEN RAISE EXCEPTION 'ORDER_INVOICE_SET_MISMATCH' USING ERRCODE = 'PT400'; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_invoice_rows) AS r(customer_org_id BIGINT, invoice_number TEXT, amount NUMERIC)
      GROUP BY r.customer_org_id HAVING count(*) <> 1 OR min(r.invoice_number) IS NULL OR min(r.amount) IS NULL OR min(r.amount) < 0
    ) THEN RAISE EXCEPTION 'VALIDATION: invalid invoice row' USING ERRCODE = 'PT400'; END IF;
    IF EXISTS (
      SELECT 1 FROM (
        SELECT o.customer_org_id, round(sum(o.billable_amount), 2) AS expected_amount
          FROM load_orders o WHERE o.carrier_org_id = v_org_id AND o.load_id = p_load_id GROUP BY o.customer_org_id
      ) expected
      JOIN jsonb_to_recordset(p_invoice_rows) AS r(customer_org_id BIGINT, invoice_number TEXT, amount NUMERIC)
        ON r.customer_org_id = expected.customer_org_id
       WHERE round(r.amount, 2) <> expected.expected_amount
    ) THEN RAISE EXCEPTION 'ORDER_CUSTOMER_AMOUNT_MISMATCH' USING ERRCODE = 'PT400'; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_invoice_rows) AS r(customer_org_id BIGINT, invoice_number TEXT, amount NUMERIC)
       WHERE NOT EXISTS (SELECT 1 FROM load_orders o WHERE o.carrier_org_id = v_org_id AND o.load_id = p_load_id AND o.customer_org_id = r.customer_org_id)
    ) THEN RAISE EXCEPTION 'ORDER_INVOICE_SET_MISMATCH' USING ERRCODE = 'PT400'; END IF;
  ELSE
    v_input_count := jsonb_array_length(p_invoice_rows);
    IF v_input_count <> 1 THEN RAISE EXCEPTION 'ORDER_INVOICE_SET_MISMATCH' USING ERRCODE = 'PT400'; END IF;
    SELECT * INTO v_row FROM jsonb_to_recordset(p_invoice_rows) AS r(customer_org_id BIGINT, invoice_number TEXT, amount NUMERIC) LIMIT 1;
    IF v_row.customer_org_id IS DISTINCT FROM v_load.customer_org_id OR v_row.amount IS NULL OR v_row.amount < 0
       OR round(v_row.amount, 2) <> round(COALESCE(v_load.rate, 0), 2) THEN
      RAISE EXCEPTION 'ORDER_CUSTOMER_AMOUNT_MISMATCH' USING ERRCODE = 'PT400';
    END IF;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_to_recordset(p_invoice_rows)
      AS r(customer_org_id BIGINT, invoice_number TEXT, amount NUMERIC)
      ORDER BY customer_org_id NULLS FIRST LOOP
    BEGIN
      INSERT INTO invoices(carrier_org_id, customer_org_id, load_id, invoice_number, amount, status, due_date, payment_method, factoring_company)
      VALUES (v_org_id, v_row.customer_org_id, p_load_id, v_row.invoice_number, v_row.amount, 'draft', p_due_date, p_payment_method, p_factoring_company)
      RETURNING id, invoice_number INTO v_invoice;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'INVOICE_EXISTS' USING ERRCODE = '23505';
    END;
    IF v_order_count > 0 THEN
      INSERT INTO invoice_order_allocations(carrier_org_id, invoice_id, load_order_id, amount)
        SELECT v_org_id, v_invoice.id, o.id, o.billable_amount FROM load_orders o
         WHERE o.carrier_org_id = v_org_id AND o.load_id = p_load_id AND o.customer_org_id = v_row.customer_org_id;
    END IF;
    INSERT INTO outbox_events(event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
    VALUES ('InvoiceCreated', 'Invoice', v_invoice.id::TEXT, v_org_id,
      jsonb_build_object('invoiceId', v_invoice.id, 'invoiceNumber', v_invoice.invoice_number,
                         'loadId', p_load_id, 'amount', v_row.amount, 'customerOrgId', v_row.customer_org_id),
      p_correlation_id, p_idempotency_key || ':' || COALESCE(v_row.customer_org_id::TEXT, 'unassigned'));
  END LOOP;

  IF p_advance_load_status AND v_load.status = 'delivered' THEN
    UPDATE loads SET status = 'invoiced' WHERE id = p_load_id AND carrier_org_id = v_org_id AND status = 'delivered';
  END IF;

  INSERT INTO outbox_events(event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES ('InvoiceBatchCreated', 'Load', p_load_id::TEXT, v_org_id,
          jsonb_build_object('loadId', p_load_id, 'invoiceCount', v_input_count), p_correlation_id, p_idempotency_key);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('invoice_id', id, 'invoice_number', invoice_number)
                            ORDER BY customer_org_id), '[]'::JSONB)
    INTO v_result FROM invoices WHERE load_id = p_load_id AND carrier_org_id = v_org_id;
  RETURN jsonb_build_object('outcome', 'APPLIED', 'invoices', v_result);
END $$;
REVOKE ALL ON FUNCTION create_load_invoices_command(BIGINT, JSONB, DATE, TEXT, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_load_invoices_command(BIGINT, JSONB, DATE, TEXT, TEXT, BOOLEAN, TEXT, TEXT) TO authenticated;
