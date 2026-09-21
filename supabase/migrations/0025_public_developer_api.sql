-- 0025_public_developer_api.sql
--
-- Phase 9: the public developer API. A genuinely new trust boundary -- external callers authenticate as an
-- ORGANIZATION via an OAuth 2.0 client-credentials grant (client_id/client_secret), never as a logged-in
-- human with a Supabase session. Nothing here is reachable by `authenticated`/`anon`: the app talks to these
-- tables only via the service-role admin client (same posture as `change_events`/`idempotency_keys`), because
-- there is no Supabase user session for RLS to key off for this caller.
--
-- Gating: Growth tier and above, via the SAME features/has_feature()/get_my_entitlements() model as every
-- other gated capability ([[feedback_data_driven_entitlements]]) -- not a second, parallel entitlement
-- system. See the `public_api` feature row below.

-- One org can hold several named clients (rotate/revoke independently without losing all API access).
-- client_secret_hash is bcrypt -- the raw secret is shown to the user exactly once, at creation, and never
-- stored or logged anywhere after that.
CREATE TABLE oauth_clients (
  id                 BIGSERIAL PRIMARY KEY,
  org_id             BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id          TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT NOT NULL,
  name               TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at       TIMESTAMPTZ,
  -- NULL = active. A revoked client's credentials must never mint a new token again (checked at token-issue
  -- time); a token already issued before revocation still expires naturally within its 1h lifetime -- the
  -- same "good until it expires" posture as the tier-downgrade case below, not a gap specific to revocation.
  revoked_at         TIMESTAMPTZ
);
CREATE INDEX idx_oauth_clients_org ON oauth_clients(org_id);
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oauth_clients FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON oauth_clients TO service_role;
GRANT USAGE, SELECT ON SEQUENCE oauth_clients_id_seq TO service_role;

COMMENT ON TABLE oauth_clients IS
  'Public developer API (Phase 9) OAuth 2.0 client-credentials clients, one org : many clients. Server-only -- no client role can read or write it, same posture as change_events/idempotency_keys.';

-- Fixed-window rate-limit counter per client_id, enforced in Postgres (no Redis -- this app already leans on
-- Postgres for shared counters, e.g. next_entity_val()/org_sequences). One row per (client, window); the
-- window is truncated to p_window_seconds so concurrent requests across multiple app instances (ECS
-- autoscaling) increment the SAME row and race safely through the atomic INSERT .. ON CONFLICT below --
-- no in-process counter, which would be wrong the moment there is more than one instance.
--
-- client_id is deliberately NOT a foreign key to oauth_clients: the token endpoint rate-limits by the
-- CLAIMED client_id before it has verified that client exists (so repeated guesses against a bogus or
-- not-yet-created id are throttled too, not just guesses against a real one) -- an FK here would turn every
-- such request into a 500 instead of the intended 401/429.
--
-- v1 scope cut: no scheduled cleanup of old window rows (same posture as send-reminders' cron not being
-- wired to a scheduler yet -- see app/api/cron/send-reminders/route.ts). At 100 req/min per client this is a
-- few hundred KB per client per day; revisit if/when a real cron runner exists.
CREATE TABLE oauth_client_rate_limits (
  client_id     TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  request_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, window_start)
);
ALTER TABLE oauth_client_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oauth_client_rate_limits FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON oauth_client_rate_limits TO service_role;

COMMENT ON TABLE oauth_client_rate_limits IS
  'Fixed-window request counters backing the public API''s 100 req/min per-client rate limit. Server-only.';

-- Atomic check-and-increment: one statement, so concurrent requests for the same client (whether same
-- process or a different ECS task) serialize through Postgres row locking on the ON CONFLICT target rather
-- than racing a read-then-write in application code.
CREATE OR REPLACE FUNCTION check_public_api_rate_limit(p_client_id TEXT, p_window_seconds INT, p_limit INT)
RETURNS TABLE(allowed BOOLEAN, current_count INT, retry_after_seconds INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count        INT;
BEGIN
  v_window_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO oauth_client_rate_limits (client_id, window_start, request_count)
  VALUES (p_client_id, v_window_start, 1)
  ON CONFLICT (client_id, window_start)
  DO UPDATE SET request_count = oauth_client_rate_limits.request_count + 1
  RETURNING oauth_client_rate_limits.request_count INTO v_count;

  RETURN QUERY SELECT
    v_count <= p_limit,
    v_count,
    CASE WHEN v_count <= p_limit THEN 0
         ELSE GREATEST(1, CEIL(p_window_seconds - extract(epoch FROM (now() - v_window_start)))::INT)
    END;
END;
$$;
REVOKE ALL ON FUNCTION check_public_api_rate_limit(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_public_api_rate_limit(TEXT, INT, INT) TO service_role;

-- The tier gate itself, single-sourced through the same entitlement model as every other gated feature.
-- min_tier = 'growth': Starter-tier orgs cannot use the public API at all (checked at token-issue time via
-- has_feature('public_api'); see server/application/public-api-auth-service.ts).
INSERT INTO features (key, label, min_tier, display_order) VALUES
  ('public_api', 'Public Developer API', 'growth', 15);
