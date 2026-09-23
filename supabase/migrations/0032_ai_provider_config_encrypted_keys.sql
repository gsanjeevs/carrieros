-- 0032_ai_provider_config_encrypted_keys.sql
--
-- decisions.md T17's 2026-09-22 amendment: an environment-variable-only LLM API key meant every key
-- rotation required someone to touch AWS Secrets Manager / `.env.local` directly -- a real deployment
-- blocker T17's original text didn't anticipate. Resolution: `sx_owner` can now set/rotate each
-- provider's API key from the same `/admin/ai-config` page, encrypted at rest -- an environment
-- variable remains a valid *fallback* (checked when no encrypted DB value is set), so this is additive,
-- not a replacement; existing `.env.local`-based local dev and already-deployed environments keep
-- working unchanged.
--
-- Six new nullable columns, one encrypted-value + one preview column per provider type (anthropic /
-- openai / openai_compatible -- the same three provider types migration 0031 already enumerates):
--   *_api_key_encrypted -- app-layer AES-256-GCM ciphertext (lib/crypto/secrets.ts's encryptSecret()),
--     packed as base64(IV[12] || authTag[16] || ciphertext) in one opaque TEXT value. Encryption and
--     decryption happen entirely in the Node process -- the plaintext key never crosses into a SQL
--     statement, so this is deliberately NOT Postgres `pgcrypto` (T17's amendment is explicit on this
--     point). Nothing in this column is decryptable without the app's SECRETS_ENCRYPTION_KEY env var,
--     which is never itself stored in this database.
--   *_api_key_preview -- the plaintext key's last 4 characters ONLY, stored separately and in the
--     clear, computed once at write time (app/api/admin/ai-config/route.ts's PUT handler, before the
--     value is encrypted). This exists so GET /api/admin/ai-config can render a masked preview
--     ("••••••••ab12") WITHOUT ever decrypting -- decryption is restricted to lib/ai/*-provider.ts at
--     actual LLM-call time (T17 amendment: "no reveal affordance anywhere"), so the admin route has no
--     way to produce a preview from the ciphertext column at all. Four characters alone cannot
--     reconstruct the key, matching the GitHub-PAT/Stripe-key masked-preview convention T17 cites.
-- Both columns of a pair are always NULL or both NOT NULL together (enforced by CHECK below) -- a
-- half-written pair would either mask a key that doesn't decrypt to anything, or store a preview with
-- nothing behind it.
--
-- Resolution order (lib/ai/index.ts's getActiveLLMProvider(), lib/ai/*-provider.ts constructors):
-- (a) decrypt *_api_key_encrypted if set, (b) fall back to the existing ANTHROPIC_API_KEY /
-- OPENAI_API_KEY / OPENAI_COMPATIBLE_API_KEY env var, (c) throw the existing "not configured" error
-- only if neither is present -- unchanged from migration 0031 when no encrypted key has ever been set.
--
-- No RLS/GRANT changes needed: ai_provider_config already has no authenticated/anon grant at all
-- (migration 0031) -- these columns inherit that same server-only posture automatically.
ALTER TABLE ai_provider_config
  ADD COLUMN anthropic_api_key_encrypted TEXT,
  ADD COLUMN anthropic_api_key_preview TEXT,
  ADD COLUMN openai_api_key_encrypted TEXT,
  ADD COLUMN openai_api_key_preview TEXT,
  ADD COLUMN openai_compatible_api_key_encrypted TEXT,
  ADD COLUMN openai_compatible_api_key_preview TEXT,
  ADD CONSTRAINT anthropic_api_key_preview_matches_encrypted CHECK (
    (anthropic_api_key_encrypted IS NULL) = (anthropic_api_key_preview IS NULL)
  ),
  ADD CONSTRAINT openai_api_key_preview_matches_encrypted CHECK (
    (openai_api_key_encrypted IS NULL) = (openai_api_key_preview IS NULL)
  ),
  ADD CONSTRAINT openai_compatible_api_key_preview_matches_encrypted CHECK (
    (openai_compatible_api_key_encrypted IS NULL) = (openai_compatible_api_key_preview IS NULL)
  );

COMMENT ON COLUMN ai_provider_config.anthropic_api_key_encrypted IS
  'AES-256-GCM ciphertext (lib/crypto/secrets.ts), base64(IV||authTag||ciphertext). NULL means "no DB-stored key -- fall back to ANTHROPIC_API_KEY env var". Decrypted only by lib/ai/anthropic-provider.ts at LLM-call time, never in the admin route.';
COMMENT ON COLUMN ai_provider_config.anthropic_api_key_preview IS
  'Plaintext last 4 characters of the currently-stored key, for GET /api/admin/ai-config''s masked preview ("••••••••" + this). Never the full key. NULL iff anthropic_api_key_encrypted is NULL.';
COMMENT ON COLUMN ai_provider_config.openai_api_key_encrypted IS
  'Same scheme as anthropic_api_key_encrypted. NULL falls back to OPENAI_API_KEY env var.';
COMMENT ON COLUMN ai_provider_config.openai_api_key_preview IS
  'Same scheme as anthropic_api_key_preview, for the openai provider.';
COMMENT ON COLUMN ai_provider_config.openai_compatible_api_key_encrypted IS
  'Same scheme as anthropic_api_key_encrypted. NULL falls back to the optional OPENAI_COMPATIBLE_API_KEY env var (self-hosted endpoints often need no key at all, unchanged from migration 0031).';
COMMENT ON COLUMN ai_provider_config.openai_compatible_api_key_preview IS
  'Same scheme as anthropic_api_key_preview, for the openai_compatible provider.';
