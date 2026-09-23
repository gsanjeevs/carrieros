-- 0029_fix_dvir_insert_tenant_check.sql
--
-- SECURITY FIX: driver_dvir_insert (0022_role_scoped_reads.sql) and driver_dvir_modify
-- (0001_baseline_schema.sql) only ever checked `driver_id = my_driver_id()` -- neither checked
-- `carrier_org_id`. A driver's own `driver_id` uniquely identifies them regardless of which org's
-- `carrier_org_id` a submitted row claims, so any authenticated driver could INSERT (and UPDATE) a
-- dvir_inspections row tagged with a FOREIGN org's carrier_org_id, injecting a fabricated
-- safety-inspection record into another carrier's DVIR compliance history. Confirmed exploitable
-- directly against a live local instance: a raw REST POST with no `.select()`/RETURNING clause
-- (so the write's own RLS success is never subject to the correctly-scoped SELECT policy) returns 201
-- and the row persists, visible to the victim org via its own carrier_dvir_select policy. Found while
-- writing tests/rls-isolation.test.ts's dvir_inspections coverage (this same commit).
--
-- Fix: both policies now additionally require carrier_org_id = my_org_id(), the same shape every other
-- driver-scoped INSERT policy in this schema already uses (e.g. driver_exception_events_insert,
-- migration 0022) -- driver_dvir_insert/_modify were the exception, not driver_dvir_defects_insert or
-- any other table, which is why this is scoped to just these two policies. dvir_defects (child table,
-- no carrier_org_id of its own) inherits safety transitively once its parent inspection can only ever
-- belong to the driver's own org.
DROP POLICY "driver_dvir_insert" ON dvir_inspections;
CREATE POLICY "driver_dvir_insert" ON dvir_inspections FOR INSERT WITH CHECK (
  driver_id = my_driver_id()
  AND carrier_org_id = my_org_id()
);

DROP POLICY "driver_dvir_modify" ON dvir_inspections;
CREATE POLICY "driver_dvir_modify" ON dvir_inspections FOR UPDATE TO authenticated
  USING (driver_id = my_driver_id() AND carrier_org_id = my_org_id())
  WITH CHECK (driver_id = my_driver_id() AND carrier_org_id = my_org_id());
