-- 0005_outbox_idempotency_audit.sql
-- Durable infrastructure for the /api/v1 command path: transactional outbox,
-- idempotency-key storage, and an append-only audit trail.
--
-- All three are ADDITIVE. Nothing existing reads or writes them yet, so this
-- migration cannot change current behaviour — it only makes the next phase
-- possible. That is deliberate: schema first, then services, then call sites.

-- ────────────────────────────────────────────────────────────────────────────
-- OUTBOX
-- ────────────────────────────────────────────────────────────────────────────
-- Why an outbox rather than emitting events directly: an aggregate write and
-- its event must both happen or neither. Publishing after commit loses events
-- when the process dies in between; publishing before commit emits events for
-- changes that then roll back. Writing the event into the SAME transaction as
-- the aggregate makes the pair atomic, and a separate worker relays it.
--
-- Supabase Realtime is explicitly NOT this mechanism. Realtime is a
-- best-effort notification to connected clients — no delivery guarantee, no
-- retry, no ordering, nothing for a client that was offline. It is fine for
-- "something changed, re-fetch", and that is all it is used for.
CREATE TABLE outbox_events (
  id               BIGSERIAL PRIMARY KEY,

  -- Business fact, past tense (MilestoneSubmitted, InvoiceDisputed, ...).
  event_type       TEXT NOT NULL,
  aggregate_type   TEXT NOT NULL,
  aggregate_id     TEXT NOT NULL,

  -- Tenant that owns the fact. Consumers must never process an event without
  -- re-establishing this scope; it is carried here so a relay never has to
  -- guess it from the payload.
  org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  payload          JSONB NOT NULL,

  -- Ties the event back to the HTTP request that produced it, through logs,
  -- audit rows and any downstream effect. The single most useful field during
  -- an incident.
  correlation_id   TEXT NOT NULL,

  -- Stable business key for the action that produced this event. UNIQUE, so a
  -- retried command cannot enqueue the same fact twice — this is what makes
  -- "replaying must not create duplicate business effects" enforceable at the
  -- database rather than hoped for in application code.
  idempotency_key  TEXT NOT NULL UNIQUE,

  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','processed','failed','dead_lettered')),

  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 8,
  -- Exponential backoff with jitter is computed by the worker and written here;
  -- the worker claims rows where next_attempt_at <= now().
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error       TEXT,

  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at     TIMESTAMPTZ,

  -- Set when an operator replays a dead-lettered event, so a replay is
  -- distinguishable from an original delivery in the audit trail.
  replayed_from_id BIGINT REFERENCES outbox_events(id),
  replayed_by      UUID REFERENCES auth.users(id)
);

-- The worker's claim query: oldest-ready-first within status.
CREATE INDEX idx_outbox_claimable
  ON outbox_events (status, next_attempt_at, id)
  WHERE status IN ('pending', 'failed');

-- Per-aggregate ordering and debugging ("what happened to this load?").
CREATE INDEX idx_outbox_aggregate ON outbox_events (aggregate_type, aggregate_id, id);
CREATE INDEX idx_outbox_correlation ON outbox_events (correlation_id);
CREATE INDEX idx_outbox_org ON outbox_events (org_id, occurred_at DESC);

COMMENT ON TABLE outbox_events IS
  'Transactional outbox. Written in the same transaction as the aggregate change it describes; relayed by a worker. Not client-readable.';

-- Infrastructure, not tenant data. No policy is defined, so RLS denies every
-- non-superuser read: the relay worker connects with elevated credentials and
-- is the only legitimate reader. Enabled anyway (rather than left off) so that
-- a future blanket GRANT cannot turn it into a readable table.
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON outbox_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE outbox_events_id_seq FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCY KEYS
-- ────────────────────────────────────────────────────────────────────────────
-- Mobile retries on flaky connections; a user double-taps; a proxy replays.
-- Without this, "submit invoice" twice creates two invoices.
--
-- request_hash is what makes reuse detectable: the same key with the same body
-- replays the stored response, the same key with a DIFFERENT body is an error
-- rather than a silent overwrite of an unrelated command's result.
CREATE TABLE idempotency_keys (
  id             BIGSERIAL PRIMARY KEY,
  org_id         BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  idempotency_key TEXT NOT NULL,
  -- Scoping the uniqueness to the endpoint prevents one client's key from
  -- colliding with another endpoint's key of the same value.
  endpoint       TEXT NOT NULL,
  request_hash   TEXT NOT NULL,

  status_code    INTEGER NOT NULL,
  response_body  JSONB,

  correlation_id TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Retention: keys are only useful for as long as a client might retry.
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',

  UNIQUE (org_id, endpoint, idempotency_key)
);

CREATE INDEX idx_idempotency_expiry ON idempotency_keys (expires_at);

COMMENT ON TABLE idempotency_keys IS
  'Stored responses for Idempotency-Key replay. Written only by the API layer.';

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
-- Read-your-own-org only, and no client writes: the API writes these using the
-- caller's session, so a policy is required for the insert to succeed, but the
-- key material is never useful to a client directly.
CREATE POLICY "idempotency_same_org" ON idempotency_keys
  FOR ALL TO authenticated
  USING (org_id = my_org_id())
  WITH CHECK (org_id = my_org_id() AND user_id = auth.uid());
GRANT SELECT, INSERT ON idempotency_keys TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE idempotency_keys_id_seq TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- AUDIT EVENTS
-- ────────────────────────────────────────────────────────────────────────────
-- Append-only. Every domain state transition and every privileged operation
-- writes one row: prior state, new state, reason, actor, scope, effective time,
-- correlation id, expected version.
--
-- The existing `admin_events` table covers SuperAdmin actions only. This is the
-- tenant-facing equivalent, and is what makes "who moved this load to
-- delivered, and when, and why" answerable — today `load_events` records the
-- what but not the actor's intent, and nothing ties it to a request.
CREATE TABLE audit_events (
  id               BIGSERIAL PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  action           TEXT NOT NULL,
  aggregate_type   TEXT NOT NULL,
  aggregate_id     TEXT NOT NULL,

  prior_state      TEXT,
  new_state        TEXT,
  reason           TEXT,

  -- The version the actor believed they were changing. Retained even on
  -- success so a conflict investigation can reconstruct interleaving.
  expected_version INTEGER,

  correlation_id   TEXT NOT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata         JSONB
);

CREATE INDEX idx_audit_org_time ON audit_events (org_id, occurred_at DESC);
CREATE INDEX idx_audit_aggregate ON audit_events (aggregate_type, aggregate_id, occurred_at DESC);
CREATE INDEX idx_audit_correlation ON audit_events (correlation_id);
CREATE INDEX idx_audit_actor ON audit_events (actor_user_id, occurred_at DESC);

COMMENT ON TABLE audit_events IS
  'Append-only tenant audit trail. No UPDATE or DELETE grant is issued to any application role.';

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Readable within your own org. Deliberately NOT readable by drivers: an audit
-- trail exposes who did what across the whole tenant, which is management
-- information rather than operational data.
CREATE POLICY "audit_read_own_org" ON audit_events
  FOR SELECT TO authenticated
  USING (org_id = my_org_id() AND my_role() IN ('owner','solo','dispatcher','finance'));

-- Inserts come from the API acting as the caller. No UPDATE/DELETE policy
-- exists at all, which is what makes the table append-only in practice: even a
-- compromised session cannot rewrite history through PostgREST.
CREATE POLICY "audit_insert_own_org" ON audit_events
  FOR INSERT TO authenticated
  WITH CHECK (org_id = my_org_id());

GRANT SELECT, INSERT ON audit_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE audit_events_id_seq TO authenticated;
-- Explicit: no UPDATE, no DELETE, for anyone.
REVOKE UPDATE, DELETE ON audit_events FROM authenticated, anon;
