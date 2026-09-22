// lib/ai/index.ts
// getActiveLLMProvider() — resolves the platform-wide active provider (decisions.md T17, amended
// 2026-09-22) from ai_provider_config (migrations 0031, 0032) and returns the matching LLMProvider
// instance, plus the resolved default model string so callers don't need to know provider-specific
// model names.
//
// Server-only: reads ai_provider_config via the service-role admin client (that table has no
// authenticated/anon grant at all — see migration 0031's comments). Each provider class resolves its
// own API key with a DB-encrypted-key-first, env-var-fallback order (T17's 2026-09-22 amendment) —
// this module's job is only to fetch the row (including the `*_api_key_encrypted` columns) and pass
// the relevant one through; decryption itself happens inside the provider constructors
// (lib/ai/*-provider.ts), never here. Never call this from a browser client.
import { createAdminClient } from '@/lib/supabase/server'
import type { LLMProvider } from './types'
import { LLMProviderNotConfiguredError } from './types'
import { AnthropicProvider } from './anthropic-provider'
import { OpenAIProvider } from './openai-provider'
import { OpenAICompatibleProvider } from './openai-compatible-provider'

export type { LLMProvider, LLMCallOptions, LLMCallResult, LLMContentBlock, LLMFailureMode } from './types'
export { LLMCallError, LLMProviderNotConfiguredError } from './types'

export interface ActiveLLMProvider {
  provider: LLMProvider
  /** ai_provider_config.model — the model string to pass as LLMCallOptions.model unless a caller
   * has a specific reason to pin a different one. */
  model: string
}

export async function getActiveLLMProvider(): Promise<ActiveLLMProvider> {
  const admin = createAdminClient()
  // A single string literal (not built via concatenation) -- supabase-js's `.select()` typing needs
  // the literal type to infer the returned row shape; see app/api/admin/ai-config/route.ts's
  // CONFIG_SELECT comment for the same gotcha.
  const { data, error } = await admin
    .from('ai_provider_config')
    .select('provider, model, compatible_base_url, anthropic_api_key_encrypted, openai_api_key_encrypted, openai_compatible_api_key_encrypted')
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
