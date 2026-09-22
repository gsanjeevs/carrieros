// app/api/admin/ai-config/route.ts
// ShipmentX admin console — LLM Provider config (decisions.md T17, amended 2026-09-22). GET returns
// the current ai_provider_config row (masked key previews only); PUT updates it, optionally
// setting/rotating/clearing each provider's API key. Gated on the admin_ai_config capability,
// sx_owner only (migration 0031) — NOT sx_finance/sx_support, since this also decides which outside
// vendor sees ticket/load content, a materially different decision than a billing override.
//
// Same convention every other /api/admin/** route uses (see app/api/admin/flags/route.ts): the
// capability check inside requireAdminRole() IS the enforcement — ai_provider_config itself has no
// authenticated/anon grant at all, so only the service-role admin client returned here can reach it.
//
// Hard security line (T17's 2026-09-22 amendment, non-negotiable): this route NEVER decrypts a stored
// key. GET only ever returns a masked preview built from the *_api_key_preview columns (migration
// 0032's plaintext-last-4-characters columns, populated at write time by this same route's PUT
// handler) — there is no "reveal full key" code path anywhere. Decryption happens exclusively in
// lib/ai/*-provider.ts at actual LLM-call time (see getActiveLLMProvider()). PUT encrypts an
// incoming key with lib/crypto/secrets.ts's encryptSecret() before it ever reaches a `.update()`
// call, so the plaintext value is in memory only for the duration of this request handler and is
// never logged (see the logError calls below — context objects only, never `body`).
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'
import { encryptSecret, previewLastFour, SecretsEncryptionKeyError } from '@/lib/crypto/secrets'
import type { Database } from '@/types/supabase'

type ConfigUpdate = Database['public']['Tables']['ai_provider_config']['Update']

const VALID_PROVIDERS = ['anthropic', 'openai', 'openai_compatible'] as const
type Provider = (typeof VALID_PROVIDERS)[number]

function isValidProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (VALID_PROVIDERS as readonly string[]).includes(value)
}

// A single string literal (not built via concatenation) -- supabase-js's `.select()` typing parses
// the literal type of this string to infer the returned row shape; a concatenated `string` loses
// that literal type and the client falls back to an untyped `GenericStringError` result.
const CONFIG_SELECT =
  'provider, model, compatible_base_url, updated_at, updated_by, anthropic_api_key_preview, openai_api_key_preview, openai_compatible_api_key_preview'

interface ConfigRow {
  provider: string
  model: string
  compatible_base_url: string | null
  updated_at: string
  updated_by: string | null
  anthropic_api_key_preview: string | null
  openai_api_key_preview: string | null
  openai_compatible_api_key_preview: string | null
}

// Last-4-characters preview -> the masked string the UI renders, e.g. "••••••••ab12". `null` ("not
// set") passes through unchanged. Never fed a full key or ciphertext -- only the *_api_key_preview
// columns, which are already just 4 characters, computed at write time (see PUT below).
function maskedPreview(lastFour: string | null): string | null {
  return lastFour ? `${'•'.repeat(8)}${lastFour}` : null
}

// Shapes a raw ai_provider_config row into the response contract -- the only thing that ever leaves
// this route about a stored key is `<provider>_key_configured` (boolean) and `<provider>_key_preview`
// (masked or null). The row's own preview columns hold only 4 characters and its encrypted columns
// are never selected into `data` in the first place (see CONFIG_SELECT above).
function toResponseConfig(data: ConfigRow) {
  return {
    provider: data.provider,
    model: data.model,
    compatible_base_url: data.compatible_base_url,
    updated_at: data.updated_at,
    updated_by: data.updated_by,
    anthropic_key_configured: data.anthropic_api_key_preview !== null,
    anthropic_key_preview: maskedPreview(data.anthropic_api_key_preview),
    openai_key_configured: data.openai_api_key_preview !== null,
    openai_key_preview: maskedPreview(data.openai_api_key_preview),
    openai_compatible_key_configured: data.openai_compatible_api_key_preview !== null,
    openai_compatible_key_preview: maskedPreview(data.openai_compatible_api_key_preview),
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAdminRole(request, 'admin_ai_config')
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const { data, error } = await admin
    .from('ai_provider_config')
    .select(CONFIG_SELECT)
    .eq('id', 1)
    .single()

  if (error || !data) {
    logError({ route: 'admin/ai-config GET', requestId: request.headers.get('x-request-id') }, error)
    return apiError('SERVER_ERROR', error?.message ?? 'Failed to load AI provider config', 500)
  }

  return NextResponse.json({ config: toResponseConfig(data) })
}

// Each of these body fields is optional and independently controls one provider's stored key:
//   - absent (key not in body at all, or `undefined`) -> leave the existing stored key untouched.
//     This is what lets a provider/model-only save (the common case) skip re-entering a key.
//   - non-empty string -> encrypt and store it (rotates/sets the key), refreshing the preview.
//   - empty string `""` -> the explicit "clear" signal: removes the stored encrypted key/preview so
//     the provider falls back to its environment variable again.
const KEY_FIELDS = [
  { body: 'anthropic_api_key', encryptedCol: 'anthropic_api_key_encrypted', previewCol: 'anthropic_api_key_preview' },
  { body: 'openai_api_key', encryptedCol: 'openai_api_key_encrypted', previewCol: 'openai_api_key_preview' },
  { body: 'openai_compatible_api_key', encryptedCol: 'openai_compatible_api_key_encrypted', previewCol: 'openai_compatible_api_key_preview' },
] as const

export async function PUT(request: NextRequest) {
  const ctx = await requireAdminRole(request, 'admin_ai_config')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const body = await request.json()
  const provider = body?.provider
  const model = body?.model
  const compatibleBaseUrl = body?.compatible_base_url

  if (!isValidProvider(provider))
    return apiError('VALIDATION_ERROR', `provider must be one of: ${VALID_PROVIDERS.join(', ')}`, 400)
  if (typeof model !== 'string' || !model.trim())
    return apiError('VALIDATION_ERROR', 'model is required', 400)
  if (provider === 'openai_compatible' && (typeof compatibleBaseUrl !== 'string' || !compatibleBaseUrl.trim()))
    return apiError('VALIDATION_ERROR', 'compatible_base_url is required when provider is openai_compatible', 400)

  const update: ConfigUpdate = {
    provider,
    model: model.trim(),
    // Only openai_compatible actually uses a base URL -- clearing it for the other two provider
    // types keeps a stale value from lingering after a provider switch.
    compatible_base_url: provider === 'openai_compatible' ? compatibleBaseUrl.trim() : null,
    updated_by: userId,
  }

  for (const field of KEY_FIELDS) {
    const raw = body?.[field.body]
    if (raw === undefined) continue // untouched -- existing stored key (if any) survives this update
    if (typeof raw !== 'string')
      return apiError('VALIDATION_ERROR', `${field.body} must be a string`, 400)
    if (raw === '') {
      // Explicit clear -- fall back to the environment variable.
      update[field.encryptedCol] = null
      update[field.previewCol] = null
      continue
    }
    try {
      update[field.encryptedCol] = encryptSecret(raw)
      update[field.previewCol] = previewLastFour(raw)
    } catch (err) {
      if (err instanceof SecretsEncryptionKeyError) {
        // Not a validation error about the *key* itself -- this is a deployment configuration gap
        // (SECRETS_ENCRYPTION_KEY unset). err.message names the missing env var, never the submitted
        // secret, so it's safe to surface directly.
        logError({ route: 'admin/ai-config PUT', requestId: request.headers.get('x-request-id'), userId }, err)
        return apiError('SERVER_ERROR', err.message, 500)
      }
      throw err
    }
  }

  const { data, error } = await admin
    .from('ai_provider_config')
    .update(update)
    .eq('id', 1)
    .select(CONFIG_SELECT)
    .single()

  if (error || !data) {
    // `update` may contain freshly-encrypted ciphertext but never a plaintext key at any point --
    // logging it here would still be safe, but it's omitted anyway since it's never needed to debug
    // a write failure (the error object already carries the DB's reason).
    logError({ route: 'admin/ai-config PUT', requestId: request.headers.get('x-request-id'), userId }, error)
    return apiError('SERVER_ERROR', error?.message ?? 'Failed to update AI provider config', 500)
  }

  return NextResponse.json({ config: toResponseConfig(data) })
}
