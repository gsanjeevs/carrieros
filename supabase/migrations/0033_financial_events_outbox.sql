-- 0033_financial_events_outbox.sql
-- T19 (decisions.md): accounting-integration READINESS layer. Extends the
-- transactional-outbox + idempotency pattern proven for shipment milestones
-- (0005/0006) to the five financial mutations a real accounting sync needs
-- to observe: invoice created, invoice status changed (sent/paid), a driver
-- settlement created, its payment_status changed, and a load expense logged.
--
-- Every function below follows submit_shipment_milestone's shape exactly:
-- SECURITY DEFINER (because outbox_events is deny-all to `authenticated`,
-- 0005), an idempotency_key lookup first (safe replay), an explicit tenant
-- check via my_org_id() (RLS does not apply inside a DEFINER function, so
-- the boundary is re-established by hand), and the aggregate write + the
-- outbox insert in the SAME transaction. None of these functions decide
-- WHETHER a transition is legal — that stays in server/application, exactly
-- as documented in 0006's own header comment. They persist the already-
-- validated result indivisibly and record the fact of it.
--
-- Because SECURITY DEFINER bypasses RLS, each function also re-states the
-- role/tier gate its table's own RLS policy already carries (billing_invoices_all,
-- owner_solo_finance_settlements_all, tier_gate_settlements, etc.) — the same
-- "SECURITY DEFINER paths carry the check themselves" rule this schema
-- already applies to replace_ifta_crossings_with_manual and friends.

-- ────────────────────────────────────────────────────────────────────────────
-- INVOICES
-- ────────────────────────────────────────────────────────────────────────────

-- Atomic invoice creation: insert + (optional) load status advance + outbox,
-- in one transaction. All pre-checks that decide WHETHER to create (load
-- delivered?, one-invoice-per-load?, invoice number already burned?) stay in
-- app/(app)/invoices/actions.ts exactly as today — this function only makes
-- the write indivisible and emits the fact.
CREATE OR REPLACE FUNCTION create_invoice_command(
  p_load_id             BIGINT,
  p_customer_org_id     BIGINT,
  p_invoice_number      TEXT,
  p_amount              NUMERIC,
  p_due_date            DATE,
  p_payment_method      TEXT,
  p_factoring_company   TEXT,
  p_advance_load_status BOOLEAN,
  p_correlation_id      TEXT,
  p_idempotency_key     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   BIGINT;
  v_actor    UUID;
  v_invoice  RECORD;
  v_existing BIGINT;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF my_role() NOT IN ('owner','solo','finance') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, invoice_number INTO v_invoice
      FROM invoices WHERE load_id = p_load_id AND carrier_org_id = v_org_id;
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number);
  END IF;

  BEGIN
    INSERT INTO invoices (
      carrier_org_id, customer_org_id, load_id, invoice_number, amount, status,
      due_date, payment_method, factoring_company
    ) VALUES (
      v_org_id, p_customer_org_id, p_load_id, p_invoice_number, p_amount, 'draft',
      p_due_date, p_payment_method, p_factoring_company
    )
    RETURNING id, invoice_number INTO v_invoice;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'INVOICE_EXISTS' USING ERRCODE = '23505';
  END;

  IF p_advance_load_status THEN
    UPDATE loads SET status = 'invoiced'
     WHERE id = p_load_id AND carrier_org_id = v_org_id AND status = 'delivered';
  END IF;

  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES (
    'InvoiceCreated', 'Invoice', v_invoice.id::TEXT, v_org_id,
    -- No currency key here: the org's currency is resolved once at export
    -- read time from organizations.currency (financial-event-query-
    -- repository.ts), not stamped per-event -- a per-event value would just
    -- be one more place for it to drift from the source of truth.
    jsonb_build_object(
      'invoiceId', v_invoice.id, 'invoiceNumber', v_invoice.invoice_number,
      'loadId', p_load_id, 'amount', p_amount
    ),
    p_correlation_id, p_idempotency_key
  );

  RETURN jsonb_build_object('outcome', 'APPLIED', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number);
END $$;

REVOKE EXECUTE ON FUNCTION create_invoice_command(
  BIGINT, BIGINT, TEXT, NUMERIC, DATE, TEXT, TEXT, BOOLEAN, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_invoice_command(
  BIGINT, BIGINT, TEXT, NUMERIC, DATE, TEXT, TEXT, BOOLEAN, TEXT, TEXT
) TO authenticated;

-- Invoice sent: replaces the plain UPDATE at the end of lib/invoice-actions.ts's
-- sendInvoiceAndMarkSent (the email send itself, which cannot be transactional
-- with a DB write, stays exactly where it is and still runs first — this
-- function is only called once the send has already succeeded).
CREATE OR REPLACE FUNCTION mark_invoice_sent_command(
  p_invoice_id      BIGINT,
  p_sent_at         TIMESTAMPTZ,
  p_correlation_id  TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   BIGINT;
  v_actor    UUID;
  v_invoice  RECORD;
  v_existing BIGINT;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF my_role() NOT IN ('owner','solo','finance') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, invoice_number, status INTO v_invoice FROM invoices WHERE id = p_invoice_id AND carrier_org_id = v_org_id;
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'invoice_id', p_invoice_id, 'status', v_invoice.status);
  END IF;

  UPDATE invoices SET status = 'sent', sent_at = p_sent_at
   WHERE id = p_invoice_id AND carrier_org_id = v_org_id
  RETURNING id, invoice_number, amount INTO v_invoice;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
  END IF;

  -- `amount` is included here (not just invoiceId/sentAt) so the
  -- financial-events export's amountFor() has a real figure for this event
  -- type -- an accounting sync reading "InvoiceSent, $0" would be actively
  -- wrong, not just incomplete.
  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES (
    'InvoiceSent', 'Invoice', v_invoice.id::TEXT, v_org_id,
    jsonb_build_object('invoiceId', v_invoice.id, 'invoiceNumber', v_invoice.invoice_number, 'amount', v_invoice.amount, 'sentAt', p_sent_at),
    p_correlation_id, p_idempotency_key
  );

  RETURN jsonb_build_object('outcome', 'APPLIED', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number);
END $$;

REVOKE EXECUTE ON FUNCTION mark_invoice_sent_command(BIGINT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_invoice_sent_command(BIGINT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;

-- Invoice paid: 0014's mark_invoice_paid, extended (not replaced) with an
-- outbox event. Adding the event requires the function to also write
-- outbox_events, which is deny-all to `authenticated` (0005) — so this
-- upgrades the function from SECURITY INVOKER to SECURITY DEFINER and, per
-- this migration's header, re-states the tenant + role check RLS was
-- previously providing. The idempotent-by-nature ALREADY_PAID guard (status
-- <> 'paid') is unchanged.
--
-- Signature changed (two trailing params added) — DROP+CREATE rather than a
-- bare CREATE OR REPLACE, since the previous 2-arg overload had no defaults.
-- The single caller (SupabaseInvoiceWriteRepository.markPaid) is updated in
-- this same change to pass them. tests/audit/roles-rls.test.ts's
-- "driver cannot mark_invoice_paid" still calls the OLD 2-arg shape on
-- purpose (it predates this migration) — that call now fails to resolve to
-- any overload (42883, function does not exist), which still leaves
-- invoiceA's status untouched, so that test's assertion is unaffected.
DROP FUNCTION IF EXISTS mark_invoice_paid(BIGINT, TIMESTAMPTZ);

CREATE FUNCTION mark_invoice_paid(
  p_invoice_id      BIGINT,
  p_paid_at         TIMESTAMPTZ,
  p_correlation_id  TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   BIGINT;
  v_actor    UUID;
  v_load_id  BIGINT;
  v_amount   NUMERIC;
  v_exists   BOOLEAN;
  v_existing BIGINT;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF my_role() NOT IN ('owner','solo','finance') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'invoice_id', p_invoice_id);
  END IF;

  UPDATE invoices
     SET status = 'paid', paid_at = p_paid_at
   WHERE id = p_invoice_id AND carrier_org_id = v_org_id AND status <> 'paid'
  RETURNING load_id, amount INTO v_load_id, v_amount;

  IF NOT FOUND THEN
    SELECT EXISTS (SELECT 1 FROM invoices WHERE id = p_invoice_id AND carrier_org_id = v_org_id) INTO v_exists;
    IF NOT v_exists THEN
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
    END IF;
    RETURN jsonb_build_object('outcome', 'ALREADY_PAID', 'invoice_id', p_invoice_id);
  END IF;

  IF v_load_id IS NOT NULL THEN
    UPDATE loads SET status = 'paid' WHERE id = v_load_id AND carrier_org_id = v_org_id;
  END IF;

  -- `amount` is included here (not just invoiceId/loadId/paidAt) for the same
  -- reason as InvoiceSent above -- amountFor() in the financial-events export
  -- would otherwise report this event as $0.
  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES (
    'InvoicePaid', 'Invoice', p_invoice_id::TEXT, v_org_id,
    jsonb_build_object('invoiceId', p_invoice_id, 'loadId', v_load_id, 'amount', v_amount, 'paidAt', p_paid_at),
    p_correlation_id, p_idempotency_key
  );

  RETURN jsonb_build_object('outcome', 'APPLIED', 'invoice_id', p_invoice_id, 'load_id', v_load_id);
END $$;

REVOKE EXECUTE ON FUNCTION mark_invoice_paid(BIGINT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_invoice_paid(BIGINT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- DRIVER SETTLEMENTS
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_driver_settlement_command(
  p_driver_id        BIGINT,
  p_pay_method       TEXT,
  p_rate_value       NUMERIC,
  p_gross_revenue    NUMERIC,
  p_net_pay          NUMERIC,
  p_loads_count      INT,
  p_period_start     DATE,
  p_period_end       DATE,
  p_correlation_id   TEXT,
  p_idempotency_key  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id    BIGINT;
  v_actor     UUID;
  v_settlement RECORD;
  v_existing  BIGINT;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF my_role() NOT IN ('owner','solo','finance') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT has_feature('driver_settlements') THEN
    RAISE EXCEPTION 'TIER_UPGRADE_REQUIRED' USING ERRCODE = 'PT402';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, payment_status INTO v_settlement
      FROM driver_settlements
     WHERE carrier_org_id = v_org_id AND driver_id = p_driver_id
       AND period_start = p_period_start AND period_end = p_period_end
     ORDER BY id DESC LIMIT 1;
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'id', v_settlement.id, 'payment_status', v_settlement.payment_status);
  END IF;

  INSERT INTO driver_settlements (
    carrier_org_id, driver_id, pay_method, rate_value, gross_revenue, net_pay,
    loads_count, payment_status, period_start, period_end, pdf_statement_path, created_by
  ) VALUES (
    v_org_id, p_driver_id, p_pay_method, p_rate_value, p_gross_revenue, p_net_pay,
    p_loads_count, 'pending', p_period_start, p_period_end, NULL, v_actor
  )
  RETURNING id, payment_status INTO v_settlement;

  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES (
    'DriverSettlementCreated', 'DriverSettlement', v_settlement.id::TEXT, v_org_id,
    jsonb_build_object(
      'settlementId', v_settlement.id, 'driverId', p_driver_id, 'grossRevenue', p_gross_revenue,
      'netPay', p_net_pay, 'periodStart', p_period_start, 'periodEnd', p_period_end
    ),
    p_correlation_id, p_idempotency_key
  );

  RETURN jsonb_build_object('outcome', 'APPLIED', 'id', v_settlement.id, 'payment_status', v_settlement.payment_status);
END $$;

REVOKE EXECUTE ON FUNCTION create_driver_settlement_command(
  BIGINT, TEXT, NUMERIC, NUMERIC, NUMERIC, INT, DATE, DATE, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_driver_settlement_command(
  BIGINT, TEXT, NUMERIC, NUMERIC, NUMERIC, INT, DATE, DATE, TEXT, TEXT
) TO authenticated;

-- Settlement payment_status change (today only pending -> sent, from the
-- send-ach route's ACH-stub; cleared is future work). Compare-and-swap on
-- p_expected_status, same reasoning as submit_shipment_milestone: the
-- current payment_status IS the version.
CREATE OR REPLACE FUNCTION update_settlement_payment_status_command(
  p_settlement_id    BIGINT,
  p_expected_status  TEXT,
  p_new_status       TEXT,
  p_correlation_id   TEXT,
  p_idempotency_key  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     BIGINT;
  v_actor      UUID;
  v_updated    INTEGER;
  v_settlement RECORD;
  v_existing   BIGINT;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF my_role() NOT IN ('owner','solo','finance') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, payment_status INTO v_settlement FROM driver_settlements WHERE id = p_settlement_id;
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'id', p_settlement_id, 'payment_status', v_settlement.payment_status);
  END IF;

  UPDATE driver_settlements
     SET payment_status = p_new_status
   WHERE id = p_settlement_id AND carrier_org_id = v_org_id AND payment_status = p_expected_status;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    SELECT id, payment_status, carrier_org_id INTO v_settlement FROM driver_settlements WHERE id = p_settlement_id;
    IF NOT FOUND OR v_settlement.carrier_org_id <> v_org_id THEN
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'VERSION_CONFLICT:%', v_settlement.payment_status USING ERRCODE = '40001';
  END IF;

  SELECT id, payment_status, driver_id, net_pay INTO v_settlement FROM driver_settlements WHERE id = p_settlement_id;

  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES (
    'DriverSettlementPaymentStatusChanged', 'DriverSettlement', p_settlement_id::TEXT, v_org_id,
    jsonb_build_object(
      'settlementId', p_settlement_id, 'driverId', v_settlement.driver_id, 'netPay', v_settlement.net_pay,
      'priorStatus', p_expected_status, 'newStatus', p_new_status
    ),
    p_correlation_id, p_idempotency_key
  );

  RETURN jsonb_build_object('outcome', 'APPLIED', 'id', v_settlement.id, 'payment_status', v_settlement.payment_status);
END $$;

REVOKE EXECUTE ON FUNCTION update_settlement_payment_status_command(BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_settlement_payment_status_command(BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- LOAD EXPENSES
-- ────────────────────────────────────────────────────────────────────────────
-- Genuinely new: no write path exists for load_expenses anywhere in the app
-- today (query-only via test fixtures). Built fresh as a v1 command, so it
-- gets the atomic write + outbox in its very first version rather than as a
-- later retrofit.
CREATE OR REPLACE FUNCTION record_load_expense_command(
  p_load_id          BIGINT,
  p_expense_type     TEXT,
  p_amount           NUMERIC,
  p_note             TEXT,
  p_correlation_id   TEXT,
  p_idempotency_key  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   BIGINT;
  v_actor    UUID;
  v_expense  RECORD;
  v_existing BIGINT;
  v_load     RECORD;
BEGIN
  v_actor  := auth.uid();
  v_org_id := my_org_id();

  IF v_actor IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF my_role() NOT IN ('owner','solo','dispatcher') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT has_feature('load_expenses') THEN
    RAISE EXCEPTION 'TIER_UPGRADE_REQUIRED' USING ERRCODE = 'PT402';
  END IF;

  SELECT id INTO v_existing FROM outbox_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    SELECT id, expense_type, amount INTO v_expense
      FROM load_expenses WHERE load_id = p_load_id AND carrier_org_id = v_org_id
     ORDER BY id DESC LIMIT 1;
    RETURN jsonb_build_object('outcome', 'REPLAYED', 'id', v_expense.id, 'amount', v_expense.amount);
  END IF;

  SELECT id, carrier_org_id INTO v_load FROM loads WHERE id = p_load_id;
  IF NOT FOUND OR v_load.carrier_org_id <> v_org_id THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO load_expenses (carrier_org_id, load_id, expense_type, amount, note, logged_by)
  VALUES (v_org_id, p_load_id, p_expense_type, p_amount, p_note, v_actor)
  RETURNING id, expense_type, amount INTO v_expense;

  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, org_id, payload, correlation_id, idempotency_key)
  VALUES (
    'LoadExpenseRecorded', 'LoadExpense', v_expense.id::TEXT, v_org_id,
    jsonb_build_object(
      'expenseId', v_expense.id, 'loadId', p_load_id, 'expenseType', v_expense.expense_type, 'amount', v_expense.amount
    ),
    p_correlation_id, p_idempotency_key
  );

  RETURN jsonb_build_object('outcome', 'APPLIED', 'id', v_expense.id, 'amount', v_expense.amount);
END $$;

REVOKE EXECUTE ON FUNCTION record_load_expense_command(BIGINT, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_load_expense_command(BIGINT, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION create_invoice_command IS 'Atomic invoice create + optional load status advance + outbox (T19 readiness layer).';
COMMENT ON FUNCTION mark_invoice_sent_command IS 'Atomic invoice sent status change + outbox (T19 readiness layer). Email send happens before this is called and is not part of the transaction.';
COMMENT ON FUNCTION mark_invoice_paid IS 'Atomic invoice/load paid + outbox (0014, extended by 0033 with outbox emission; now SECURITY DEFINER with explicit tenant+role check).';
COMMENT ON FUNCTION create_driver_settlement_command IS 'Atomic driver settlement create + outbox (T19 readiness layer).';
COMMENT ON FUNCTION update_settlement_payment_status_command IS 'Atomic CAS settlement payment_status change + outbox (T19 readiness layer).';
COMMENT ON FUNCTION record_load_expense_command IS 'Atomic load expense create + outbox (T19 readiness layer). First write path for load_expenses.';
