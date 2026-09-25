-- 0038_app_error_log.sql
--
-- Platform-admin "Debug / Error Log" viewer. lib/observability.ts's logError()
-- already does the real work of error tracking (structured console.error JSON
-- line + Sentry.captureException, no-op unless a DSN is configured) -- this
-- table is NOT a second logging pipeline. It's a lightweight, best-effort
-- mirror of the same calls into Postgres so a ShipmentX admin without Sentry
-- access can see "what errored, on which route, for which org/user, recently"
-- without needing a Sentry seat. Full stack traces stay in Sentry only --
-- this table never stores one (see the `message`/`context` column comments).
--
-- Write path: exclusively logError() itself (lib/observability.ts), via the
-- service-role admin client (lib/supabase/server.ts's createAdminClient(),
-- same client every /api/admin/** route uses per lib/admin-auth.ts), wrapped
-- in its own try/catch so a DB hiccup can never turn a logged error into an
-- unhandled one or block the response. Read path: GET /api/v1/admin/error-log,
-- gated by requireAdminRole() exactly like every other admin route.
CREATE TABLE app_error_log (
  id          BIGSERIAL PRIMARY KEY,
  route       TEXT NOT NULL,
  -- Short, already-serialized message only (serializeError(error).message) --
  -- deliberately NOT the `stack` field serializeError() also produces. Stack
  -- traces are Sentry's job (captureException in the same logError() call);
  -- duplicating them here would be exactly the second logging pipeline this
  -- table is scoped to avoid.
  message     TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'error' CHECK (level = 'error'),
  org_id      BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  request_id  TEXT,
  -- Small, non-sensitive `extra` fields only (e.g. route/status/failureMode-
  -- style context) -- logError()'s insert redacts anything secret/token-
  -- shaped and never a raw request/response body. Not a general-purpose
  -- metadata bag.
  context     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_error_log IS
  'Best-effort mirror of lib/observability.ts logError() calls, for the ShipmentX admin Debug/Error Log viewer (app/(admin)/admin/logs). Not a replacement for Sentry (full stack traces live there only) and has no retention/cleanup job yet -- unbounded growth is a known follow-up, out of scope here.';
COMMENT ON COLUMN app_error_log.message IS 'Short serialized error message only -- never a stack trace (Sentry has that).';
COMMENT ON COLUMN app_error_log.context IS 'Small non-secret extra fields (route/status/failureMode-style) only -- never raw request/response bodies or anything secret/token-shaped.';

CREATE INDEX idx_app_error_log_created_at ON app_error_log(created_at DESC);
CREATE INDEX idx_app_error_log_org_id ON app_error_log(org_id);

-- Server-only, same posture as ai_provider_config (migration 0031) --
-- written exclusively by logError()'s service-role insert and read
-- exclusively by GET /api/v1/admin/error-log's service-role admin client.
-- No authenticated/anon grant at all -- there is no legitimate reason for a
-- tenant session to read or write this table directly.
ALTER TABLE app_error_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_error_log FROM anon, authenticated;
GRANT SELECT, INSERT ON app_error_log TO service_role;
-- SECTION 5's blanket `GRANT ... ON ALL SEQUENCES ... TO authenticated,
-- service_role` (migration 0001) would otherwise leave `authenticated` able
-- to advance this sequence directly; revoke it back off, same as
-- outbox_events_id_seq/change_events_id_seq (migrations 0005/0012).
REVOKE ALL ON SEQUENCE app_error_log_id_seq FROM anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE app_error_log_id_seq TO service_role;
