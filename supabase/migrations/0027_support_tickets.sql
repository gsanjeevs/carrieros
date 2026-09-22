-- 0027_support_tickets.sql
--
-- In-app support ticketing with AI triage routing (decisions.md T16). Resolves PR1's "dedicated
-- support" half of Enterprise's originally-undefined "white-label + dedicated support" line (the
-- other half, branding, was migration 0026).
--
-- Three-queue model, decided in T16, not re-derived here:
--   carrieros_support — CarrierOS's own platform-staff queue (sx_owner/sx_support). Available on
--     EVERY tier — this is baseline "get help with the product", not an upsell.
--   org_support       — the submitting user's OWN carrier org's support staff. Enterprise-gated
--     (has_feature('support_desk')) — below Enterprise there is no third bucket, the classifier only
--     ever chooses between carrieros_support and ai_resolved.
--   ai_resolved        — the triage step answered directly, above a confidence threshold. Never a
--     dead end: fallback_queue records which human queue this WOULD have gone to, so "still need
--     help?" can reopen it via escalate_support_ticket() below.
--
-- Who can submit: any authenticated user, any role, any tier (T16's explicit scope) — the INSERT
-- policy only requires submitted_by = auth.uid() and carrier_org_id = my_org_id(), no capability gate.
--
-- Category + a couple of conditional fields (not a dynamic form builder, per the task brief's own
-- explicit guidance not to over-engineer this for a first build) — category picker drives which
-- follow-up field the client shows (today: related_load_number for 'load_dispatch').

CREATE TABLE support_tickets (
  id                   BIGSERIAL PRIMARY KEY,
  submitted_by         UUID NOT NULL REFERENCES profiles(id),
  carrier_org_id       BIGINT NOT NULL REFERENCES organizations(id),
  -- Identity/context captured automatically at submission time (never asked of the user directly,
  -- per T16's explicit "record details about them... ask the right question" framing) — snapshotted
  -- rather than joined live so a later role change or tier change doesn't rewrite ticket history.
  submitter_role       TEXT NOT NULL,
  submitter_tier       TEXT,   -- carrier_details.tier at submission time; NULL for non-carrier (platform-org) submitters
  category             TEXT NOT NULL CHECK (category IN (
    'technical_issue','load_dispatch','account_billing','compliance_safety','driver_pay_hr','feature_request','other'
  )),
  related_load_number  TEXT,   -- conditional field, shown client-side only for category = 'load_dispatch'
  body                 TEXT NOT NULL,
  queue                TEXT NOT NULL CHECK (queue IN ('carrieros_support','org_support','ai_resolved')),
  -- Only set when queue = 'ai_resolved' — the human queue the classifier would have routed to had it
  -- not auto-resolved. escalate_support_ticket() reopens into exactly this queue (T16: "reopens it
  -- into whichever queue the original classification pointed at").
  fallback_queue       TEXT CHECK (fallback_queue IN ('carrieros_support','org_support')),
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','closed')),
  ai_confidence        NUMERIC CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  ai_answer            TEXT,   -- populated when queue = 'ai_resolved'; also mirrored into the first thread message
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at          TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fallback_queue_only_when_ai_resolved CHECK (
    (queue = 'ai_resolved' AND fallback_queue IS NOT NULL) OR
    (queue <> 'ai_resolved' AND fallback_queue IS NULL)
  )
);

COMMENT ON TABLE support_tickets IS
  'In-app support ticketing (decisions.md T16). AI-triaged into carrieros_support/org_support/ai_resolved on creation — see lib/support-triage.ts. RLS: submitter sees own; org_support staff (owner/solo, Enterprise-gated) see their own org''s org_support-queue tickets only; sx_owner/sx_support see carrieros_support-queue tickets regardless of org (mirrors admin_notes'' "gated on my_role() alone" precedent, SECTION 3c).';

CREATE INDEX idx_support_tickets_org           ON support_tickets(carrier_org_id);
CREATE INDEX idx_support_tickets_submitter     ON support_tickets(submitted_by);
CREATE INDEX idx_support_tickets_queue_status  ON support_tickets(queue, status);

-- Ticket thread/replies — mirrors driver_messages' shape (schema.sql SECTION 3, 7D) rather than
-- inventing a chat system: one row per message, sender_id NULL = system/AI-generated.
CREATE TABLE support_ticket_messages (
  id              BIGSERIAL PRIMARY KEY,
  ticket_id       BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  -- Denormalized from the parent ticket so RLS policies here don't need a subquery for the common
  -- case, and so this table itself carries a `_org_id` column for Rule L's isolation-test heuristic.
  carrier_org_id  BIGINT NOT NULL REFERENCES organizations(id),
  sender_id       UUID REFERENCES profiles(id),   -- NULL = AI-generated or system message
  is_ai_generated BOOLEAN NOT NULL DEFAULT false,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE support_ticket_messages IS
  'Reply thread for support_tickets (decisions.md T16). sender_id NULL + is_ai_generated true = the auto-answer message inserted alongside an ai_resolved ticket.';

CREATE INDEX idx_support_ticket_messages_ticket ON support_ticket_messages(ticket_id);
CREATE INDEX idx_support_ticket_messages_org    ON support_ticket_messages(carrier_org_id);

CREATE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────
-- Tier gate + capability (same conventions as migration 0026's branding_customization/org_branding_manage)
-- ────────────────────────────────────────────────────────────

INSERT INTO features (key, label, min_tier, display_order) VALUES
  ('support_desk', 'Dedicated Support Desk', 'enterprise', 17);

COMMENT ON COLUMN support_tickets.queue IS
  'carrieros_support: CarrierOS platform staff, every tier. org_support: the submitting org''s own staff, requires has_feature(''support_desk'') = Enterprise. ai_resolved: auto-answered, no human touch yet.';

-- Who may staff an org's own org_support queue: owner/solo by default, same default-grant shape as
-- org_branding_manage (migration 0026) and every other org-administration capability (0023).
INSERT INTO role_capabilities (role, capability) VALUES
  ('owner', 'org_support_manage'),
  ('solo',  'org_support_manage');

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may create a ticket for themselves, in their own org — no capability gate
-- (T16: "ANY authenticated user, any role, any tier"). The actual queue/ai_* fields are computed
-- server-side by the API route (app/api/support/tickets/route.ts) before this INSERT ever runs; this
-- policy only constrains WHO the row can claim to belong to.
CREATE POLICY "submitter_creates_own_ticket" ON support_tickets FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid() AND carrier_org_id = my_org_id());

CREATE POLICY "submitter_own_tickets_select" ON support_tickets FOR SELECT TO authenticated
  USING (submitted_by = auth.uid());

-- Enterprise-gated: org_support is not a valid routing target at all below has_feature('support_desk'),
-- so no row a non-Enterprise org's staff could see should ever exist with queue='org_support' for
-- them anyway — the has_feature() check here is defense in depth (e.g. a downgrade after tickets
-- already exist in that queue).
CREATE POLICY "org_support_staff_select" ON support_tickets FOR SELECT TO authenticated
  USING (
    queue = 'org_support'
    AND carrier_org_id = my_org_id()
    AND my_role() IN ('owner','solo')
    AND has_feature('support_desk')
  );
CREATE POLICY "org_support_staff_update" ON support_tickets FOR UPDATE TO authenticated
  USING (
    queue = 'org_support'
    AND carrier_org_id = my_org_id()
    AND my_role() IN ('owner','solo')
    AND has_feature('support_desk')
  )
  WITH CHECK (
    queue = 'org_support'
    AND carrier_org_id = my_org_id()
    AND my_role() IN ('owner','solo')
    AND has_feature('support_desk')
  );

-- carrieros_support tickets are NOT scoped to ShipmentX's own org_id — they're submitted by carrier-
-- org users and routed to ShipmentX's queue, the same "gated on my_role() alone, no org-membership
-- check" shape admin_notes already uses (SECTION 3c) and for the identical reason: only a trusted
-- action ever assigns an sx_* role. app/api/admin/support-tickets/** routes use the service-role
-- admin client per lib/admin-auth.ts convention regardless; this is defense in depth / consistency
-- with that existing precedent, not the only enforcement point.
CREATE POLICY "sx_carrieros_support_select" ON support_tickets FOR SELECT TO authenticated
  USING (queue = 'carrieros_support' AND my_role() IN ('sx_owner','sx_support'));
CREATE POLICY "sx_carrieros_support_update" ON support_tickets FOR UPDATE TO authenticated
  USING (queue = 'carrieros_support' AND my_role() IN ('sx_owner','sx_support'))
  WITH CHECK (queue = 'carrieros_support' AND my_role() IN ('sx_owner','sx_support'));

ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_owner_messages_select" ON support_ticket_messages FOR SELECT TO authenticated
  USING (ticket_id IN (SELECT id FROM support_tickets WHERE submitted_by = auth.uid()));

CREATE POLICY "ticket_owner_messages_insert" ON support_ticket_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND carrier_org_id = my_org_id()
    AND ticket_id IN (SELECT id FROM support_tickets WHERE submitted_by = auth.uid())
  );

CREATE POLICY "org_support_staff_messages_select" ON support_ticket_messages FOR SELECT TO authenticated
  USING (
    carrier_org_id = my_org_id()
    AND my_role() IN ('owner','solo')
    AND has_feature('support_desk')
    AND ticket_id IN (SELECT id FROM support_tickets WHERE queue = 'org_support')
  );
CREATE POLICY "org_support_staff_messages_insert" ON support_ticket_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND carrier_org_id = my_org_id()
    AND my_role() IN ('owner','solo')
    AND has_feature('support_desk')
    AND ticket_id IN (SELECT id FROM support_tickets WHERE queue = 'org_support')
  );

CREATE POLICY "sx_carrieros_support_messages_select" ON support_ticket_messages FOR SELECT TO authenticated
  USING (
    my_role() IN ('sx_owner','sx_support')
    AND ticket_id IN (SELECT id FROM support_tickets WHERE queue = 'carrieros_support')
  );
CREATE POLICY "sx_carrieros_support_messages_insert" ON support_ticket_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND my_role() IN ('sx_owner','sx_support')
    AND ticket_id IN (SELECT id FROM support_tickets WHERE queue = 'carrieros_support')
  );

-- Base table grants — new tables created after SECTION 8c's blanket GRANT already ran need their own
-- explicit grant on a live (already-migrated) database; RLS above is what actually restricts access.
-- Same requirement migration 0009 hit for role_capabilities.
GRANT SELECT, INSERT, UPDATE, DELETE ON support_tickets, support_ticket_messages TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE support_tickets_id_seq, support_ticket_messages_id_seq TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- Escalation RPC — "still need help?" on an ai_resolved ticket (T16: never a dead end)
-- ────────────────────────────────────────────────────────────
--
-- A plain RLS UPDATE policy could let a submitter set queue/status to anything reachable from their
-- own row; this is a real state transition (queue AND status change together, and only from a
-- specific prior state) so it's a SECURITY DEFINER RPC instead, same idiom as submit_dvir_inspection()/
-- log_vehicle_service() (migrations 0017/0015) for real business-logic transitions rather than a raw
-- table write.
CREATE OR REPLACE FUNCTION escalate_support_ticket(p_ticket_id BIGINT)
RETURNS support_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket support_tickets;
BEGIN
  SELECT * INTO v_ticket FROM support_tickets WHERE id = p_ticket_id AND submitted_by = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_ticket.queue <> 'ai_resolved' OR v_ticket.fallback_queue IS NULL THEN
    RAISE EXCEPTION 'Ticket is not eligible for escalation' USING ERRCODE = '22023';
  END IF;

  UPDATE support_tickets
  SET queue = v_ticket.fallback_queue,
      fallback_queue = NULL,  -- the fallback_queue_only_when_ai_resolved CHECK requires this once queue is no longer ai_resolved
      status = 'open',
      resolved_at = NULL
  WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  INSERT INTO support_ticket_messages (ticket_id, carrier_org_id, sender_id, is_ai_generated, body)
  VALUES (p_ticket_id, v_ticket.carrier_org_id, auth.uid(), false, '[Escalated to a human — still need help with this.]');

  RETURN v_ticket;
END;
$$;
GRANT EXECUTE ON FUNCTION escalate_support_ticket(BIGINT) TO authenticated;
