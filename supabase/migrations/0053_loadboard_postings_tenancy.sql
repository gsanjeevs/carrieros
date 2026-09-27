-- 0053_loadboard_postings_tenancy.sql
--
-- Fixes forward a real tenancy gap in migration 0052 (found while writing tests/rls-isolation.test.ts
-- for loadboard_postings, immutable now that it's applied -- see CLAUDE.md's migration-immutability
-- rule): the carrier_loadboard_postings_insert RLS policy only checks
-- `carrier_org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher')`. RLS validates the row
-- being written, not what its foreign keys point at -- nothing stopped a caller from inserting
-- carrier_org_id = their OWN org while load_id points at a DIFFERENT org's load, since the FK on
-- load_id only requires the referenced load to exist somewhere, not that it belongs to the same
-- carrier_org_id on the row.
--
-- Same class of gap, same fix, as migration 0019's enforce_load_reference_tenancy()/
-- enforce_contact_customer_tenancy() triggers (loads.driver_id/vehicle_id/customer_org_id and
-- customer_contacts.org_id) -- "Tenant guards on foreign keys that RLS cannot express... [a]pplies to
-- every caller including service_role: the data must be consistent." LoadboardPostingService
-- (server/application/loadboard-service.ts) always derives carrier_org_id from the load's own actual
-- carrier_org_id via LoadboardPostingRepository.getLoadForPosting (itself scoped by actor.orgId), so
-- the application never actually produces a mismatched row -- but RLS/the DB should not rely on
-- application code being the only thing enforcing that, same reasoning 0019 gave.
CREATE OR REPLACE FUNCTION enforce_loadboard_posting_tenancy() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.load_id IS DISTINCT FROM OLD.load_id OR NEW.carrier_org_id IS DISTINCT FROM OLD.carrier_org_id)
     AND NOT EXISTS (SELECT 1 FROM loads WHERE id = NEW.load_id AND carrier_org_id = NEW.carrier_org_id) THEN
    RAISE EXCEPTION 'load does not belong to this carrier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER loadboard_postings_tenancy BEFORE INSERT OR UPDATE ON loadboard_postings
  FOR EACH ROW EXECUTE FUNCTION enforce_loadboard_posting_tenancy();
