// lib/ai/index.ts
// getActiveLLMProvider() — resolves the platform-wide active provider (decisions.md T17) from
// ai_provider_config (migration 0031) and returns the matching LLMProvider instance, plus the
// resolved default model string so callers don't need to know provider-specific model names.
//
// Server-only: reads ai_provider_config via the service-role admin client (that table has no
// authenticated/anon grant at all — see migration 0031's comments), and every provider class reads
// its API key from process.env. Never call this from a browser client.
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
  const { data, error } = await admin
    .from('ai_provider_config')
    .select('provider, model, compatible_base_url')
    .eq('id', 1)
    .single()

  if (error || !data) {
    throw new LLMProviderNotConfiguredError('ai_provider_config row not found — has migration 0031 been applied?')
  }

  const provider = buildProvider(data.provider, data.compatible_base_url)
  return { provider, model: data.model }
}

function buildProvider(providerName: string, compatibleBaseUrl: string | null): LLMProvider {
  switch (providerName) {
    case 'anthropic':
      return new AnthropicProvider()
    case 'openai':
      return new OpenAIProvider()
    case 'openai_compatible':
      return new OpenAICompatibleProvider(compatibleBaseUrl)
    default:
      throw new LLMProviderNotConfiguredError(`Unknown ai_provider_config.provider value: ${providerName}`)
  }
}
