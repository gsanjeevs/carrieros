-- 0036_ai_feature_overrides.sql
--
-- Per-feature LLM override, on top of ai_provider_config's platform-wide default
-- (migrations 0031/0032). Requested directly: the user wants to run a specific
-- feature (starting with translation) on a different/cheaper model - including a
-- self-hosted open-weight model via the existing openai_compatible provider type
-- - without that choice affecting every other AI feature (load extraction,
-- support triage) sharing the same global config.
--
-- Same shape and security posture as ai_provider_config, just keyed by feature
-- instead of being a singleton: NO row for a feature means "use the global
-- ai_provider_config", exactly like today. A row's mere presence is a full
-- override — this table never partially merges with the global config, same
-- self-contained-row philosophy ai_provider_config already uses.
--
-- feature is a real CHECK-constrained enum, not a free string, so a typo can't
-- silently create a dead override no code ever reads. Extend the CHECK (and the
-- matching TS union in lib/ai/index.ts) when another feature opts in - both
-- must change together or the new value is rejected at the DB layer with no code
-- path ever selecting it.
CREATE TABLE ai_feature_overrides (
  feature              TEXT PRIMARY KEY CHECK (feature IN ('translation')),
  provider             TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai', 'openai_compatible')),
  model                TEXT NOT NULL,
  compatible_base_url  TEXT,
  anthropic_api_key_encrypted TEXT,
  anthropic_api_key_preview TEXT,
  openai_api_key_encrypted TEXT,
  openai_api_key_preview TEXT,
  openai_compatible_api_key_encrypted TEXT,
  openai_compatible_api_key_preview TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           UUID REFERENCES profiles(id),
  CONSTRAINT compatible_base_url_required_for_openai_compatible CHECK (
    (provider = 'openai_compatible' AND compatible_base_url IS NOT NULL AND compatible_base_url <> '')
    OR (provider <> 'openai_compatible')
  ),
  CONSTRAINT anthropic_api_key_preview_matches_encrypted CHECK (
    (anthropic_api_key_encrypted IS NULL) = (anthropic_api_key_preview IS NULL)
  ),
  CONSTRAINT openai_api_key_preview_matches_encrypted CHECK (
    (openai_api_key_encrypted IS NULL) = (openai_api_key_preview IS NULL)
  ),
  CONSTRAINT openai_compatible_api_key_preview_matches_encrypted CHECK (
    (openai_compatible_api_key_encrypted IS NULL) = (openai_compatible_api_key_preview IS NULL)
  )
);

COMMENT ON TABLE ai_feature_overrides IS
  'Per-feature LLM override on top of ai_provider_config''s platform-wide default. No row for a feature = use the global config. Never holds a credential in the clear -- same encrypted-key/preview-pair scheme as ai_provider_config (migration 0032). Changed only via /api/admin/ai-config/features/{feature}, sx_owner only (admin_ai_config capability).';

CREATE TRIGGER ai_feature_overrides_updated_at
  BEFORE UPDATE ON ai_feature_overrides FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Same server-only posture as ai_provider_config: no legitimate reason for a
-- tenant session to read or write this table directly.
ALTER TABLE ai_feature_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_feature_overrides FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_feature_overrides TO service_role;
