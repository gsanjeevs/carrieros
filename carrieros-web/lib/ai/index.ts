// lib/ai/index.ts
// getActiveLLMProvider() — resolves the active provider (decisions.md T17, amended 2026-09-22, and
// the 2026-09-24 per-feature override) and returns the matching LLMProvider instance, plus the
// resolved model string so callers don't need to know provider-specific model names.
//
// Server-only: reads ai_provider_config / ai_feature_overrides via the service-role admin client
// (neither table has an authenticated/anon grant at all). Each provider class resolves its own API
// key with a DB-encrypted-key-first, env-var-fallback order (T17's 2026-09-22 amendment) — this
// module's job is only to fetch the row and pass the relevant key through; decryption itself happens
// inside the provider constructors (lib/ai/*-provider.ts), never here. Never call this from a
// browser client.
import { createAdminClient } from '@/lib/supabase/server'
import type { LLMProvider, AiFeature } from './types'
import { LLMProviderNotConfiguredError } from './types'
import { AnthropicProvider } from './anthropic-provider'
import { OpenAIProvider } from './openai-provider'
import { OpenAICompatibleProvider } from './openai-compatible-provider'

export type { LLMProvider, LLMCallOptions, LLMCallResult, LLMContentBlock, LLMFailureMode, AiFeature } from './types'
export { LLMCallError, LLMProviderNotConfiguredError, AI_FEATURES } from './types'

export interface ActiveLLMProvider {
  provider: LLMProvider
  /** The resolved model string to pass as LLMCallOptions.model unless a caller has a specific reason
   * to pin a different one. */
  model: string
}

const CONFIG_COLUMNS = 'provider, model, compatible_base_url, anthropic_api_key_encrypted, openai_api_key_encrypted, openai_compatible_api_key_encrypted'

/**
 * Resolves the LLM provider a caller should use. With no `feature`, or when the named feature has
 * no override row, this is the platform-wide default (ai_provider_config, unchanged behavior). When
 * `feature` has a row in ai_feature_overrides, that row is used INSTEAD of the global default —
 * never merged with it — same self-contained-row philosophy ai_provider_config already uses.
 */
export async function getActiveLLMProvider(feature?: AiFeature): Promise<ActiveLLMProvider> {
  const admin = createAdminClient()

  if (feature) {
    const { data: override, error: overrideError } = await admin
      .from('ai_feature_overrides')
      .select(CONFIG_COLUMNS)
      .eq('feature', feature)
      .maybeSingle()
    if (overrideError) throw new LLMProviderNotConfiguredError(`ai_feature_overrides lookup for "${feature}" failed: ${overrideError.message}`)
    if (override) return { provider: buildProvider(override), model: override.model }
  }

  const { data, error } = await admin
    .from('ai_provider_config')
    .select(CONFIG_COLUMNS)
    .eq('id', 1)
    .single()

  if (error || !data) {
    throw new LLMProviderNotConfiguredError('ai_provider_config row not found — has migration 0031 been applied?')
  }

  const provider = buildProvider(data)
  return { provider, model: data.model }
}

interface ConfigRow {
  provider: string
  compatible_base_url: string | null
  anthropic_api_key_encrypted: string | null
  openai_api_key_encrypted: string | null
  openai_compatible_api_key_encrypted: string | null
}

function buildProvider(data: ConfigRow): LLMProvider {
  switch (data.provider) {
    case 'anthropic':
      return new AnthropicProvider(data.anthropic_api_key_encrypted)
    case 'openai':
      return new OpenAIProvider(data.openai_api_key_encrypted)
    case 'openai_compatible':
      return new OpenAICompatibleProvider(data.compatible_base_url, data.openai_compatible_api_key_encrypted)
    default:
      throw new LLMProviderNotConfiguredError(`Unknown ai_provider_config.provider value: ${data.provider}`)
  }
}
