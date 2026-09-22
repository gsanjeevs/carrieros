-- 0031_ai_provider_config.sql
--
-- Platform-wide LLM provider abstraction (decisions.md T17). Both real LLM integrations (T6 load
-- extraction, T16 support-ticket triage) move off a hardcoded `@anthropic-ai/sdk` call onto the new
-- lib/ai/ provider abstraction -- this migration is the config side of that: a single, platform-wide
-- (NOT per-org, per T17's explicit scoping) row picking which provider is active. See lib/ai/index.ts
-- (getActiveLLMProvider()) for the reader.
--
-- Singleton-row pattern (id BIGINT PRIMARY KEY DEFAULT 1 CHECK (id = 1)), same idiom this schema
-- doesn't yet have a named precedent for but is the standard "exactly one row, ever" shape -- enforced
-- by the CHECK, not just convention, so a second row is a constraint violation, not a silent app bug.
--
-- Where credentials live -- a hard line, not a detail (T17): this table holds a provider NAME, a MODEL
-- string, and (for openai_compatible) a base URL -- never a credential. Every provider's actual API key
-- stays in an environment variable (ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENAI_COMPATIBLE_API_KEY,
-- the last one optional since self-hosted endpoints often need none), read directly by lib/ai/*
-- provider classes, never written to or read from Postgres. Storing a real API key in an app-writable
-- table was never on the table -- Postgres backups, replicas, and every service-role query surface
-- would expose it.
--
-- Default provider is 'openai' (T17: "let us use openai api key instead of anthropic" -- requested
-- directly as the new default), NOT 'anthropic' -- a deliberate change from every existing LLM call's
-- prior behavior. Default model 'gpt-5-mini': the fast/cheap-tier model in OpenAI's current lineup,
-- chosen for the same reason T6 originally picked claude-haiku-4-5 over a larger Claude model --
-- per-keystroke/per-paste extraction and per-ticket triage are latency- and cost-sensitive, not
-- reasoning-depth-sensitive, so a mini/fast-tier model is the right default, not the flagship.
--
-- Who can change it: new admin_ai_config capability, sx_owner only -- T17 is explicit this is NOT
-- opened to sx_finance/sx_support despite being cost-adjacent, since it also decides which outside
-- vendor sees ticket/load content, a materially different kind of decision than a billing override.
-- Same default-grant shape as admin_flags/admin_billing (migration 0009/0023), one INSERT per role.
CREATE TABLE ai_provider_config (
  id                   BIGINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider             TEXT NOT NULL DEFAULT 'openai' CHECK (provider IN ('anthropic', 'openai', 'openai_compatible')),
  model                TEXT NOT NULL DEFAULT 'gpt-5-mini',
  -- Required only when provider = 'openai_compatible' -- enforced by the CHECK below rather than a
  -- NOT NULL, since the column is meaningless (and left NULL) for the other two provider types.
  compatible_base_url  TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           UUID REFERENCES profiles(id),
  CONSTRAINT compatible_base_url_required_for_openai_compatible CHECK (
    (provider = 'openai_compatible' AND compatible_base_url IS NOT NULL AND compatible_base_url <> '')
    OR (provider <> 'openai_compatible')
  )
);

COMMENT ON TABLE ai_provider_config IS
  'Singleton row (id always 1) selecting the platform-wide active LLM provider (decisions.md T17). Never holds a credential -- provider API keys live in environment variables only, read by lib/ai/*. Changed only via PUT /api/admin/ai-config, sx_owner only (admin_ai_config capability).';

INSERT INTO ai_provider_config (id) VALUES (1);

CREATE TRIGGER ai_provider_config_updated_at
  BEFORE UPDATE ON ai_provider_config FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Server-only, same posture as change_events/idempotency_keys/oauth_clients (SECTION 23) -- the app
-- reads this exclusively through lib/ai/index.ts's service-role admin client (getActiveLLMProvider()
-- runs server-side only, never in a browser client per T17), and app/api/admin/ai-config/route.ts is
-- the only write path, also via the service-role admin client per lib/admin-auth.ts convention. No
-- authenticated/anon grant at all -- there is no legitimate reason for a tenant session to read or
-- write this table directly.
ALTER TABLE ai_provider_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_provider_config FROM anon, authenticated;
GRANT SELECT, UPDATE ON ai_provider_config TO service_role;

INSERT INTO role_capabilities (role, capability) VALUES
  ('sx_owner', 'admin_ai_config');
