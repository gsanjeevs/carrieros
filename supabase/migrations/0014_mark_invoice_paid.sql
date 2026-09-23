-- 0014_mark_invoice_paid.sql
-- Marking an invoice paid also marks its load paid. Mobile did those as two separate
-- writes, so a failure between them left an invoice paid and its load still invoiced.
--
-- SECURITY INVOKER, deliberately (unlike submit_shipment_milestone): both updates run
-- as the CALLER, so row-level security on invoices and loads still governs who may do
-- this. The function only adds atomicity; it grants no new access. Who may call it
-- (owner/solo/finance) is decided by the application layer and, beneath it, by RLS.
--
-- The invoice update is conditional (status <> 'paid'), which makes the call
-- idempotent by nature: a second call reports ALREADY_PAID and touches nothing.

CREATE OR REPLACE FUNCTION mark_invoice_paid(p_invoice_id BIGINT, p_paid_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_load_id BIGINT;
  v_exists  BOOLEAN;
BEGIN
  UPDATE invoices
     SET status = 'paid', paid_at = p_paid_at
   WHERE id = p_invoice_id AND status <> 'paid'
  RETURNING load_id INTO v_load_id;

  IF NOT FOUND THEN
    SELECT EXISTS (SELECT 1 FROM invoices WHERE id = p_invoice_id) INTO v_exists;
    IF NOT v_exists THEN
      -- Missing and not-visible-to-you are the same answer on purpose.
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
    END IF;
    RETURN jsonb_build_object('outcome', 'ALREADY_PAID', 'invoice_id', p_invoice_id);
  END IF;

  IF v_load_id IS NOT NULL THEN
    UPDATE loads SET status = 'paid' WHERE id = v_load_id;
  END IF;

  RETURN jsonb_build_object('outcome', 'APPLIED', 'invoice_id', p_invoice_id, 'load_id', v_load_id);
END $$;

REVOKE EXECUTE ON FUNCTION mark_invoice_paid(BIGINT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_invoice_paid(BIGINT, TIMESTAMPTZ) TO authenticated;
