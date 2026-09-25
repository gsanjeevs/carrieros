-- 0037_webhooks.sql
-- Org-level outbound webhooks (Integrations, Settings > Integrations): a
-- carrier registers a URL of their own (their TMS, Zapier, etc.) to receive
-- event notifications for things happening in their org. First real version
-- — no external job queue; delivery is attempted inline/best-effort from the
-- request path by server/application/webhook-dispatch-service.ts, and every
-- attempt is recorded here in webhook_deliveries for observability/retry.
--
-- RLS-scoped (unlike oauth_clients/0025, which is service_role-only because
-- its caller has no session at all): a webhook's owner is always a logged-in
-- owner/solo human acting through the ordinary Settings surface, exactly the
-- population vehicles/customers already RLS-scope by my_org_id() +
-- my_role(). Mirrors vehicles' policy shape (0001/schema.sql) exactly.

CREATE TABLE webhooks (
  id                 BIGSERIAL PRIMARY KEY,
  org_id             BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url                TEXT NOT NULL,

  -- The org's OWN outbound-delivery secret, used only to HMAC-sign the
  -- payloads this app sends to `url` — never a third-party credential, so
  -- this deliberately does NOT use lib/crypto/secrets.ts's
  -- encrypt-at-rest-for-a-column pattern (that pattern exists for secrets
  -- ai_provider_config never needs to read back in plaintext for signing;
  -- this one is read on every delivery attempt). Rotated via rotate-secret,
  -- never edited directly.
  secret             TEXT NOT NULL,

  -- Event types this webhook receives, e.g. 'load.delivered', 'invoice.paid'.
  -- No FK/enum: the set of event types is defined in application code
  -- (server/domain/webhooks/events.ts) and evolves there, not in the schema.
  subscribed_events  TEXT[] NOT NULL DEFAULT '{}',

  enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX webhooks_org_id_idx ON webhooks(org_id);

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
-- Owner/solo only, both directions — same posture as
-- owner_solo_vehicles_all, but with no separate broader-role SELECT policy
-- (unlike vehicles' carrier_vehicles_select): a webhook's secret is
-- sensitive and dispatchers/finance/drivers have no legitimate reason to
-- see it, let alone manage it.
CREATE POLICY "owner_solo_webhooks_all" ON webhooks FOR ALL USING (
  org_id = my_org_id()
  AND my_role() IN ('owner','solo')
) WITH CHECK (
  org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

CREATE TABLE webhook_deliveries (
  id                  BIGSERIAL PRIMARY KEY,
  webhook_id          BIGINT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  -- Denormalized from webhooks.org_id so RLS here doesn't need a subquery
  -- join through webhooks for every row (same tradeoff load_events makes
  -- with carrier_org_id alongside load_id).
  org_id              BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type          TEXT NOT NULL,
  payload             JSONB NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_attempted_at   TIMESTAMPTZ,
  last_response_status INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX webhook_deliveries_webhook_id_idx ON webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX webhook_deliveries_org_id_idx ON webhook_deliveries(org_id);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
-- Read-only from the RLS-scoped client (owner/solo, same population as the
-- webhooks table itself); all writes happen from
-- SupabaseWebhookDeliveryRepository under service_role, since dispatch runs
-- fire-and-forget outside any one human's request/session.
CREATE POLICY "owner_solo_webhook_deliveries_select" ON webhook_deliveries FOR SELECT USING (
  org_id = my_org_id()
  AND my_role() IN ('owner','solo')
);

COMMENT ON TABLE webhooks IS 'Org-registered outbound webhook endpoints (Settings > Integrations). First real webhook infra in this codebase.';
COMMENT ON TABLE webhook_deliveries IS 'Delivery attempt log for webhooks — observability + bounded inline retry, no external job queue.';
