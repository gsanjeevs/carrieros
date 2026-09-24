// lib/ai/admin-config-shared.ts
// Shared validation and key-handling between the two admin LLM-config routes:
// app/api/admin/ai-config/route.ts (the platform-wide default,
// ai_provider_config) and app/api/admin/ai-config/features/[feature]/route.ts
// (per-feature overrides, ai_feature_overrides, migration 0036). Both tables
// have the identical provider/model/compatible_base_url/*_api_key_encrypted
// shape, so this is the one place the encrypt-on-write, mask-on-read, and
// explicit-clear-signal logic lives — extracted here specifically so the new
// per-feature route doesn't duplicate the security-sensitive half of the
// original route (decisions.md T17's 2026-09-22 amendment: never decrypt in
// an admin route, key ciphertext never logged).
import { apiError } from '@/lib/api-auth'
import { encryptSecret, previewLastFour, SecretsEncryptionKeyError } from '@/lib/crypto/secrets'
import { logError } from '@/lib/observability'

export const VALID_PROVIDERS = ['anthropic', 'openai', 'openai_compatible'] as const
export type Provider = (typeof VALID_PROVIDERS)[number]

export function isValidProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (VALID_PROVIDERS as readonly string[]).includes(value)
}

export const KEY_FIELDS = [
  { body: 'anthropic_api_key', encryptedCol: 'anthropic_api_key_encrypted', previewCol: 'anthropic_api_key_preview' },
  { body: 'openai_api_key', encryptedCol: 'openai_api_key_encrypted', previewCol: 'openai_api_key_preview' },
  { body: 'openai_compatible_api_key', encryptedCol: 'openai_compatible_api_key_encrypted', previewCol: 'openai_compatible_api_key_preview' },
] as const

// Last-4-characters preview -> the masked string the UI renders, e.g. "••••••••ab12".
export function maskedPreview(lastFour: string | null): string | null {
  return lastFour ? `${'•'.repeat(8)}${lastFour}` : null
}

/**
 * Same three-way semantics for each of the three provider key fields:
 *   - absent from body -> leave the existing stored key untouched (skip).
 *   - non-empty string -> encrypt and store it (rotates/sets the key).
 *   - empty string "" -> explicit clear: falls back to the environment variable.
 * Mutates `update` in place; returns an error NextResponse on the first
 * validation/encryption failure, or null on success.
 */
export function applyKeyFields(
  update: Record<string, unknown>,
  body: Record<string, unknown>,
  context: { route: string; requestId: string | null; userId: string }
) {
  for (const field of KEY_FIELDS) {
    const raw = body[field.body]
    if (raw === undefined) continue
    if (typeof raw !== 'string') return apiError('VALIDATION_ERROR', `${field.body} must be a string`, 400)
    if (raw === '') {
      update[field.encryptedCol] = null
      update[field.previewCol] = null
      continue
    }
    try {
      update[field.encryptedCol] = encryptSecret(raw)
      update[field.previewCol] = previewLastFour(raw)
    } catch (err) {
      if (err instanceof SecretsEncryptionKeyError) {
        // Not a validation error about the *key* itself -- a deployment configuration gap
        // (SECRETS_ENCRYPTION_KEY unset). err.message names the missing env var, never the
        // submitted secret, so it's safe to surface directly.
        logError({ route: context.route, requestId: context.requestId, userId: context.userId }, err)
        return apiError('SERVER_ERROR', err.message, 500)
      }
      throw err
    }
  }
  return null
}
