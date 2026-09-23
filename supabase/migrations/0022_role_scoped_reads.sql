-- 0022_role_scoped_reads.sql
-- Read-scope findings from the 2026-09-20 roles audit: RLS proved tenancy well but not ROLE. Most read policies
-- were "anyone in the org", and 39 of them subqueried profiles directly, which ignores is_active, so a deactivated
-- user kept working access for as long as their token lived.
--
--  1. Deactivation now reaches every policy: raw `(SELECT org_id/role FROM profiles WHERE id = auth.uid())` and
--     `(SELECT id FROM drivers WHERE profile_id = auth.uid())` become my_org_id() / my_role() / my_driver_id(),
--     which return NULL for an inactive profile (so every comparison fails closed). profiles' own policies are left
--     alone: a user must still be able to read their own row to be told they are deactivated.
--  2. Role-scoped reads: a driver no longer reads other drivers' documents (CDL scans), other loads' documents, or
--     load expenses; finance no longer reads driver documents; only office roles list a carrier's customers (which
--     carry private notes/tags), and a portal login no longer reads its carrier-side customer row.
--     Dispatchers keep driver-document reads: their role includes the `drivers` capability.
--  3. Finance may change a load only to move it to invoiced/paid (finance_loads_update let it rewrite anything).
--  4. get_exceptions() and mark_overdue_invoices() are office-role only (a driver could read invoice amounts and
--     compliance detail, or flip invoices to overdue).
--
-- NOT fixed here, needs the API migration first: drivers and portal logins still read loads.rate/internal columns
-- from the base table because RLS cannot hide columns and the apps still query it directly.

CREATE OR REPLACE FUNCTION my_driver_id()
RETURNS BIGINT LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT d.id FROM drivers d JOIN profiles p ON p.id = d.profile_id WHERE p.id = auth.uid() AND p.is_active = true
$$;
REVOKE EXECUTE ON FUNCTION my_driver_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_driver_id() TO authenticated;

DROP POLICY "carrier_details_select" ON carrier_details;
CREATE POLICY "carrier_details_select" ON carrier_details FOR SELECT USING (
  org_id = my_org_id()
);

DROP POLICY "carrier_customer_select" ON customer_details;
CREATE POLICY "carrier_customer_select" ON customer_details FOR SELECT USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher','finance')
);

DROP POLICY "carrier_docs_select" ON documents;
CREATE POLICY "carrier_docs_select" ON documents FOR SELECT USING (
  carrier_org_id = my_org_id()
  AND (my_role() <> 'driver' OR uploaded_by = auth.uid() OR load_id IN (SELECT id FROM loads WHERE driver_id = my_driver_id()))
);

DROP POLICY "owner_solo_docs_all" ON documents;
CREATE POLICY "owner_solo_docs_all" ON documents FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

DROP POLICY "carrier_driver_docs_select" ON driver_documents;
CREATE POLICY "carrier_driver_docs_select" ON driver_documents FOR SELECT USING (
  carrier_org_id = my_org_id()
  AND (my_role() IN ('owner','solo','dispatcher') OR driver_id = my_driver_id())
);

DROP POLICY "owner_solo_driver_docs_all" ON driver_documents;
CREATE POLICY "owner_solo_driver_docs_all" ON driver_documents FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

DROP POLICY "driver_thread_messages_insert" ON driver_messages;
CREATE POLICY "driver_thread_messages_insert" ON driver_messages FOR INSERT TO authenticated WITH CHECK (
  carrier_org_id = my_org_id()
  AND sender_id = auth.uid()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = my_driver_id())
);

DROP POLICY "driver_thread_messages_select" ON driver_messages;
CREATE POLICY "driver_thread_messages_select" ON driver_messages FOR SELECT TO authenticated USING (
  carrier_org_id = my_org_id()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = my_driver_id())
);

DROP POLICY "driver_thread_messages_update" ON driver_messages;
CREATE POLICY "driver_thread_messages_update" ON driver_messages FOR UPDATE TO authenticated USING (
  carrier_org_id = my_org_id()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = my_driver_id())
) WITH CHECK (
  carrier_org_id = my_org_id()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = my_driver_id())
);

DROP POLICY "driver_own_settlements_select" ON driver_settlements;
CREATE POLICY "driver_own_settlements_select" ON driver_settlements FOR SELECT TO authenticated USING (
  driver_id = my_driver_id()
);

DROP POLICY "dispatcher_drivers_select" ON drivers;
CREATE POLICY "dispatcher_drivers_select" ON drivers FOR SELECT USING (
  carrier_org_id = my_org_id()
  AND my_role() = 'dispatcher'
);

DROP POLICY "owner_solo_drivers_all" ON drivers;
CREATE POLICY "owner_solo_drivers_all" ON drivers FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

DROP POLICY "driver_dvir_defects_insert" ON dvir_defects;
CREATE POLICY "driver_dvir_defects_insert" ON dvir_defects FOR INSERT WITH CHECK (
  inspection_id IN (SELECT id FROM dvir_inspections WHERE driver_id = my_driver_id())
);

DROP POLICY "dvir_defects_select" ON dvir_defects;
CREATE POLICY "dvir_defects_select" ON dvir_defects FOR SELECT USING (
  inspection_id IN (SELECT id FROM dvir_inspections WHERE carrier_org_id = my_org_id())
);

DROP POLICY "carrier_dvir_select" ON dvir_inspections;
CREATE POLICY "carrier_dvir_select" ON dvir_inspections FOR SELECT USING (
  carrier_org_id = my_org_id()
);

DROP POLICY "driver_dvir_insert" ON dvir_inspections;
CREATE POLICY "driver_dvir_insert" ON dvir_inspections FOR INSERT WITH CHECK (
  driver_id = my_driver_id()
);

DROP POLICY "owner_solo_dvir_all" ON dvir_inspections;
CREATE POLICY "owner_solo_dvir_all" ON dvir_inspections FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

DROP POLICY "driver_exception_events_insert" ON exception_events;
CREATE POLICY "driver_exception_events_insert" ON exception_events FOR INSERT TO authenticated
  WITH CHECK (
    carrier_org_id = my_org_id()
    AND my_role() = 'driver'
    AND entity_type = 'load'
    AND event_type = 'driver_reported_problem'
    AND entity_id IN (SELECT id FROM loads WHERE driver_id = my_driver_id())
  );

DROP POLICY "driver_fuel_stops_insert" ON fuel_stops;
CREATE POLICY "driver_fuel_stops_insert" ON fuel_stops FOR INSERT TO authenticated WITH CHECK (
  carrier_org_id = my_org_id() AND driver_id = my_driver_id()
);

DROP POLICY "driver_ifta_crossings_insert" ON ifta_state_crossings;
CREATE POLICY "driver_ifta_crossings_insert" ON ifta_state_crossings FOR INSERT TO authenticated WITH CHECK (
  carrier_org_id = my_org_id() AND driver_id = my_driver_id()
);

DROP POLICY "billing_invoices_all" ON invoices;
CREATE POLICY "billing_invoices_all" ON invoices FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo','finance')
);

DROP POLICY "carrier_load_events_select" ON load_events;
CREATE POLICY "carrier_load_events_select" ON load_events FOR SELECT USING (
  load_id IN (SELECT id FROM loads WHERE carrier_org_id = my_org_id())
);

DROP POLICY "carrier_load_expenses_select" ON load_expenses;
CREATE POLICY "carrier_load_expenses_select" ON load_expenses FOR SELECT TO authenticated USING (
  carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher','finance')
);

DROP POLICY "dispatcher_loads_select" ON loads;
CREATE POLICY "dispatcher_loads_select" ON loads FOR SELECT USING (
  carrier_org_id = my_org_id()
  AND my_role() = 'dispatcher'
);

DROP POLICY "driver_loads_update_status" ON loads;
CREATE POLICY "driver_loads_update_status" ON loads FOR UPDATE USING (
  driver_id = my_driver_id()
) WITH CHECK (true);

DROP POLICY "driver_own_loads_select" ON loads;
CREATE POLICY "driver_own_loads_select" ON loads FOR SELECT USING (
  driver_id = my_driver_id()
);

DROP POLICY "finance_loads_select" ON loads;
CREATE POLICY "finance_loads_select" ON loads FOR SELECT USING (
  carrier_org_id = my_org_id()
  AND my_role() = 'finance'
);

DROP POLICY "owner_solo_loads_all" ON loads;
CREATE POLICY "owner_solo_loads_all" ON loads FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

DROP POLICY "carrier_reminders_select" ON maintenance_reminders;
CREATE POLICY "carrier_reminders_select" ON maintenance_reminders FOR SELECT USING (
  carrier_org_id = my_org_id()
);

DROP POLICY "owner_solo_reminders_all" ON maintenance_reminders;
CREATE POLICY "owner_solo_reminders_all" ON maintenance_reminders FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

DROP POLICY "finance_org_docs_select" ON org_documents;
CREATE POLICY "finance_org_docs_select" ON org_documents FOR SELECT USING (
  org_id = my_org_id()
  AND my_role() = 'finance'
);

DROP POLICY "owner_solo_org_docs_all" ON org_documents;
CREATE POLICY "owner_solo_org_docs_all" ON org_documents FOR ALL USING (
  org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

DROP POLICY "org_member_select" ON organizations;
CREATE POLICY "org_member_select" ON organizations FOR SELECT USING (
  id = my_org_id()
  OR id IN (SELECT carrier_org_id FROM customer_details WHERE org_id = my_org_id())
);

DROP POLICY "owner_solo_org_update" ON organizations;
CREATE POLICY "owner_solo_org_update" ON organizations FOR UPDATE USING (
  id = my_org_id()
  AND my_role() IN ('owner','solo')
);

DROP POLICY "carrier_service_logs_select" ON service_logs;
CREATE POLICY "carrier_service_logs_select" ON service_logs FOR SELECT USING (
  carrier_org_id = my_org_id()
);

DROP POLICY "owner_solo_service_logs_all" ON service_logs;
CREATE POLICY "owner_solo_service_logs_all" ON service_logs FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

DROP POLICY "same_org_settlement_deductions_select" ON settlement_deductions;
CREATE POLICY "same_org_settlement_deductions_select" ON settlement_deductions FOR SELECT TO authenticated USING (
  settlement_id IN (
    SELECT ds.id FROM driver_settlements ds
    WHERE ds.carrier_org_id = my_org_id()
       OR ds.driver_id = my_driver_id()
  )
);

DROP POLICY "carrier_vehicle_docs_select" ON vehicle_documents;
CREATE POLICY "carrier_vehicle_docs_select" ON vehicle_documents FOR SELECT USING (
  carrier_org_id = my_org_id()
);

DROP POLICY "owner_solo_vehicle_docs_all" ON vehicle_documents;
CREATE POLICY "owner_solo_vehicle_docs_all" ON vehicle_documents FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

DROP POLICY "carrier_vehicles_select" ON vehicles;
CREATE POLICY "carrier_vehicles_select" ON vehicles FOR SELECT USING (
  carrier_org_id = my_org_id()
);

DROP POLICY "owner_solo_vehicles_all" ON vehicles;
CREATE POLICY "owner_solo_vehicles_all" ON vehicles FOR ALL USING (
  carrier_org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

-- 3. Finance: status to invoiced/paid only. Same technique as 0018 (RLS cannot say which columns).
CREATE OR REPLACE FUNCTION enforce_finance_load_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_ignored TEXT[] := ARRAY['status', 'updated_at'];
BEGIN
  IF my_role() = 'finance' THEN
    IF (to_jsonb(NEW) - v_ignored) IS DISTINCT FROM (to_jsonb(OLD) - v_ignored) THEN
      RAISE EXCEPTION 'finance may only change a load''s billing status' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('invoiced', 'paid') THEN
      RAISE EXCEPTION 'finance may only move a load to invoiced or paid' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER loads_finance_columns BEFORE UPDATE ON loads
  FOR EACH ROW EXECUTE FUNCTION enforce_finance_load_columns();

-- 4. Office roles only.
CREATE OR REPLACE FUNCTION mark_overdue_invoices()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF my_role() IS NULL OR my_role() NOT IN ('owner', 'solo', 'dispatcher', 'finance') THEN
    RETURN 0;
  END IF;
  UPDATE invoices SET status = 'overdue'
  WHERE status = 'sent' AND due_date < CURRENT_DATE
    AND carrier_org_id = my_org_id();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- get_exceptions(): the existing body moves to an internal function that no client role can call; the public name
-- becomes a role-checked wrapper with the same signature.
CREATE OR REPLACE FUNCTION public.get_exceptions_unchecked()
 RETURNS TABLE(entity_type text, entity_id bigint, exception_type text, tier text, title text, detail text, due_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

  -- 1) INVOICES: overdue, or about to become overdue. No "upcoming" tier --
  -- an invoice not yet due within a week isn't an exception yet.
  SELECT
    'invoice'::TEXT,
    i.id,
    'invoice_overdue'::TEXT,
    CASE WHEN i.due_date < CURRENT_DATE THEN 'today' ELSE 'this_week' END,
    'Invoice overdue'::TEXT,
    'Invoice ' || i.invoice_number || ' for $' || i.amount || ' due ' || to_char(i.due_date, 'Mon DD, YYYY'),
    i.due_date::TIMESTAMPTZ
  FROM invoices i
  WHERE i.carrier_org_id = my_org_id()
    AND i.status IN ('sent', 'overdue')
    AND i.due_date IS NOT NULL
    AND i.due_date <= CURRENT_DATE + INTERVAL '7 days'

  UNION ALL

  -- 2) ORG DOCUMENTS: carrier's own compliance docs (COI, MC authority, UCR,
  -- etc.) -- these are typically annual filings, so the "upcoming" horizon
  -- is the widest of the doc branches (180 days, per the UCR-style hint).
  -- entity_type is 'organization', NOT 'customer' -- this branch is scoped
  -- to `od.org_id = my_org_id()`, i.e. the CARRIER's own org, never an
  -- actual customer org. Bug found 2026-07-21: it was originally mislabeled
  -- 'customer', which meant these exceptions silently could never match any
  -- customer-entity filter anywhere in the app (there's no page that lists
  -- exceptions for the carrier's own org itself, only the aggregate inbox/
  -- banner, which don't filter by entity_type -- so this only ever broke a
  -- hypothetical future per-entity view, not anything currently built).
  SELECT
    'organization'::TEXT,
    od.org_id,
    CASE WHEN od.expiry_date < CURRENT_DATE THEN 'doc_expired' ELSE 'doc_expiring' END,
    CASE
      WHEN od.expiry_date < CURRENT_DATE THEN 'today'
      WHEN od.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    CASE WHEN od.expiry_date < CURRENT_DATE THEN 'Compliance document expired' ELSE 'Compliance document expiring' END,
    COALESCE(od.label, od.doc_type) || ' expires ' || to_char(od.expiry_date, 'Mon DD, YYYY'),
    od.expiry_date::TIMESTAMPTZ
  FROM org_documents od
  WHERE od.org_id = my_org_id()
    AND od.expiry_date IS NOT NULL
    AND od.expiry_date <= CURRENT_DATE + INTERVAL '180 days'

  UNION ALL

  -- 3) VEHICLE DOCUMENTS: registration/insurance/DOT authority/annual
  -- inspection -- a middle horizon (60 days) between CDL (30) and the
  -- UCR-style org docs (180); these are typically renewed annually but
  -- carriers plan for them further ahead than a driver's own CDL.
  SELECT
    'vehicle'::TEXT,
    vd.vehicle_id,
    CASE WHEN vd.expiry_date < CURRENT_DATE THEN 'doc_expired' ELSE 'doc_expiring' END,
    CASE
      WHEN vd.expiry_date < CURRENT_DATE THEN 'today'
      WHEN vd.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    CASE WHEN vd.expiry_date < CURRENT_DATE THEN 'Vehicle document expired' ELSE 'Vehicle document expiring' END,
    v.nickname || ': ' || COALESCE(vd.label, vd.doc_type) || ' expires ' || to_char(vd.expiry_date, 'Mon DD, YYYY'),
    vd.expiry_date::TIMESTAMPTZ
  FROM vehicle_documents vd
  JOIN vehicles v ON v.id = vd.vehicle_id
  WHERE vd.carrier_org_id = my_org_id()
    AND vd.expiry_date IS NOT NULL
    AND vd.expiry_date <= CURRENT_DATE + INTERVAL '60 days'

  UNION ALL

  -- 4) DRIVER CDL EXPIRY: authoritative structured field (drivers.cdl_expiry),
  -- not driver_documents -- see function-level note above. 30-day horizon
  -- per the CDL-specific hint.
  SELECT
    'driver'::TEXT,
    d.id,
    'cdl_expiring'::TEXT,
    CASE
      WHEN d.cdl_expiry < CURRENT_DATE THEN 'today'
      WHEN d.cdl_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    'CDL expiring'::TEXT,
    trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) || '''s CDL expires ' || to_char(d.cdl_expiry, 'Mon DD, YYYY'),
    d.cdl_expiry::TIMESTAMPTZ
  FROM drivers d
  JOIN profiles p ON p.id = d.profile_id
  WHERE d.carrier_org_id = my_org_id()
    AND d.cdl_expiry IS NOT NULL
    AND d.cdl_expiry <= CURRENT_DATE + INTERVAL '30 days'

  UNION ALL

  -- 5) DRIVER MEDICAL CERT EXPIRY: same authoritative-field reasoning as CDL
  -- above, same 30-day horizon (DOT physicals are typically flagged on a
  -- similarly short runway).
  SELECT
    'driver'::TEXT,
    d.id,
    'med_cert_expiring'::TEXT,
    CASE
      WHEN d.med_cert_expiry < CURRENT_DATE THEN 'today'
      WHEN d.med_cert_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    'Medical certificate expiring'::TEXT,
    trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) || '''s medical certificate expires ' || to_char(d.med_cert_expiry, 'Mon DD, YYYY'),
    d.med_cert_expiry::TIMESTAMPTZ
  FROM drivers d
  JOIN profiles p ON p.id = d.profile_id
  WHERE d.carrier_org_id = my_org_id()
    AND d.med_cert_expiry IS NOT NULL
    AND d.med_cert_expiry <= CURRENT_DATE + INTERVAL '30 days'

  UNION ALL

  -- 6) POD MISSING: a load marked delivered with no matching 'pod'-type
  -- document row. No natural due date to look forward to (delivery already
  -- happened), so tiering instead reflects how overdue the paperwork is: a
  -- 2-day grace period after delivery before this escalates from
  -- 'this_week' to 'today'. due_at is the delivery date (when the POD
  -- should have been captured), falling back to updated_at if delivery_date
  -- was never recorded.
  SELECT
    'load'::TEXT,
    l.id,
    'pod_missing'::TEXT,
    CASE
      WHEN l.delivery_date IS NULL OR l.delivery_date <= CURRENT_DATE - INTERVAL '2 days' THEN 'today'
      ELSE 'this_week'
    END,
    'POD missing'::TEXT,
    'Load ' || l.load_number || ' delivered without a proof of delivery',
    COALESCE(l.delivery_date::TIMESTAMPTZ, l.updated_at)
  FROM loads l
  WHERE l.carrier_org_id = my_org_id()
    AND l.status = 'delivered'
    AND NOT EXISTS (
      SELECT 1 FROM documents doc WHERE doc.load_id = l.id AND doc.type = 'pod'
    )

  UNION ALL

  -- 7) MAINTENANCE DUE: date-based reminders only -- see function-level note
  -- on next_due_miles above. entity_type is 'vehicle' (the reminder is about
  -- the vehicle, not a standalone entity of its own). 30-day horizon, same
  -- reasoning as CDL: maintenance intervals are usually planned on a
  -- similarly short runway, not an annual one.
  SELECT
    'vehicle'::TEXT,
    mr.vehicle_id,
    'maintenance_due'::TEXT,
    CASE
      WHEN mr.next_due_date < CURRENT_DATE THEN 'today'
      WHEN mr.next_due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'this_week'
      ELSE 'upcoming'
    END,
    'Maintenance due'::TEXT,
    v.nickname || ': ' || mr.reminder_type || ' due ' || to_char(mr.next_due_date, 'Mon DD, YYYY'),
    mr.next_due_date::TIMESTAMPTZ
  FROM maintenance_reminders mr
  JOIN vehicles v ON v.id = mr.vehicle_id
  WHERE mr.carrier_org_id = my_org_id()
    AND mr.is_active = true
    AND mr.next_due_date IS NOT NULL
    AND mr.next_due_date <= CURRENT_DATE + INTERVAL '30 days'

$function$;
REVOKE EXECUTE ON FUNCTION get_exceptions_unchecked() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION get_exceptions()
RETURNS TABLE(entity_type TEXT, entity_id BIGINT, exception_type TEXT, tier TEXT, title TEXT, detail TEXT, due_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM get_exceptions_unchecked() WHERE my_role() IN ('owner', 'solo', 'dispatcher', 'finance');
$$;
