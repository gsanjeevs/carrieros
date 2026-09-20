-- 0012_change_events.sql
-- Change feed backing the API's live-update stream (GET /api/v1/events).
--
-- Model: SIGNAL ONLY. A row says "something of kind X changed for org N" and
-- carries no business data. Clients react by re-fetching through the API, which
-- applies the caller's role and tenant rules as it does for any read. That keeps
-- the API the single data path (ADR 0003): this table cannot leak a rate to a
-- driver because it never holds one, and it needs no per-role filtering.
--
-- Why a table + polling rather than LISTEN/NOTIFY: the API runs as short-lived
-- serverless invocations, which cannot hold a long-lived Postgres connection to
-- LISTEN on. A cursor over an indexed table works identically on Vercel, a
-- container, or a laptop, survives reconnects (Last-Event-ID), and is trivially
-- testable.
--
-- Access: deny-all to client roles, like outbox_events (0005). Only the API
-- (service_role) reads it. Rows are short-lived; the API prunes old ones.

CREATE TABLE change_events (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT NOT NULL,
  entity     TEXT NOT NULL,   -- 'loads' | 'exceptions' | 'invoices' | 'messages' | 'documents'
  entity_id  BIGINT,
  op         TEXT NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_change_events_org_cursor ON change_events (org_id, id);
CREATE INDEX idx_change_events_created ON change_events (created_at);

COMMENT ON TABLE change_events IS
  'Signal-only change feed for the live-update SSE stream. No business data; clients refetch through the API. Deny-all to client roles; short retention (pruned by the API).';

ALTER TABLE change_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON change_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE change_events_id_seq FROM anon, authenticated;
GRANT SELECT, DELETE ON change_events TO service_role;

-- Trigger function. SECURITY DEFINER because the writing user (an authenticated
-- driver, say) has no privilege on change_events by design; search_path is
-- pinned. TG_ARGV[0] = entity name, TG_ARGV[1] = the column holding the org id.
CREATE OR REPLACE FUNCTION emit_change_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row JSONB := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_org BIGINT := NULLIF(v_row ->> TG_ARGV[1], '')::BIGINT;
BEGIN
  IF v_org IS NOT NULL THEN
    INSERT INTO change_events (org_id, entity, entity_id, op)
    VALUES (v_org, TG_ARGV[0], NULLIF(v_row ->> 'id', '')::BIGINT, TG_OP);
  END IF;
  RETURN NULL;
END $$;

-- load_events has no org column; its org is the parent load's. A timeline entry
-- is a change to the load as far as any screen is concerned.
CREATE OR REPLACE FUNCTION emit_change_event_via_load() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_load_id BIGINT := CASE WHEN TG_OP = 'DELETE' THEN OLD.load_id ELSE NEW.load_id END;
  v_org BIGINT;
BEGIN
  SELECT carrier_org_id INTO v_org FROM loads WHERE id = v_load_id;
  IF v_org IS NOT NULL THEN
    INSERT INTO change_events (org_id, entity, entity_id, op) VALUES (v_org, 'loads', v_load_id, TG_OP);
  END IF;
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION emit_change_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION emit_change_event_via_load() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER loads_change_event AFTER INSERT OR UPDATE OR DELETE ON loads
  FOR EACH ROW EXECUTE FUNCTION emit_change_event('loads', 'carrier_org_id');
CREATE TRIGGER load_events_change_event AFTER INSERT OR UPDATE OR DELETE ON load_events
  FOR EACH ROW EXECUTE FUNCTION emit_change_event_via_load();
CREATE TRIGGER exception_events_change_event AFTER INSERT OR UPDATE OR DELETE ON exception_events
  FOR EACH ROW EXECUTE FUNCTION emit_change_event('exceptions', 'carrier_org_id');
CREATE TRIGGER invoices_change_event AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION emit_change_event('invoices', 'carrier_org_id');
CREATE TRIGGER driver_messages_change_event AFTER INSERT OR UPDATE OR DELETE ON driver_messages
  FOR EACH ROW EXECUTE FUNCTION emit_change_event('messages', 'carrier_org_id');
CREATE TRIGGER documents_change_event AFTER INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION emit_change_event('documents', 'carrier_org_id');
