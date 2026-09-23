// lib/ai/anthropic-provider.ts
// Anthropic implementation of lib/ai/types.ts's LLMProvider — unchanged behavior from the
// pre-T17 direct `@anthropic-ai/sdk` calls in lib/extract-load.ts/lib/support-triage.ts, now
// reached through the abstraction instead of directly (decisions.md T17). The status->failureMode
// classification below is copied verbatim from those two files, not redesigned.
//
// Key resolution (T17's 2026-09-22 amendment): the constructor takes the ai_provider_config row's
// `anthropic_api_key_encrypted` value (fetched, but never decrypted, by lib/ai/index.ts). If set, it
// is decrypted right here via lib/crypto/secrets.ts — this is the ONLY place that decryption happens
// for this provider, immediately before constructing the SDK client. Falls back to ANTHROPIC_API_KEY
// when no encrypted key is stored, preserving pre-amendment behavior for untouched deployments.
import Anthropic from '@anthropic-ai/sdk'
import type { LLMCallOptions, LLMCallResult, LLMContentBlock, LLMProvider } from './types'
import { LLMCallError, LLMProviderNotConfiguredError } from './types'
import { decryptSecret } from '../crypto/secrets'

function toAnthropicContent(userContent: string | LLMContentBlock[]): Anthropic.MessageParam['content'] {
  if (typeof userContent === 'string') return userContent
  return userContent.map((block): Anthropic.ContentBlockParam => {
    if (block.type === 'text') return { type: 'text', text: block.text }
    return { type: 'image', source: { type: 'base64', media_type: block.mediaType as 'image/jpeg' | 'image/png' | 'image/webp', data: block.data } }
  })
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic

  constructor(encryptedApiKey?: string | null) {
    // Decrypted DB key takes priority over the env var (T17's 2026-09-22 amendment) — decryptSecret()
    // throws SecretDecryptionError (not silently swallowed) if the stored value doesn't decrypt under
    // the current SECRETS_ENCRYPTION_KEY, which is a real misconfiguration distinct from "no key set".
    const apiKey = encryptedApiKey ? decryptSecret(encryptedApiKey) : process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new LLMProviderNotConfiguredError('ANTHROPIC_API_KEY not configured')
    }
    this.client = new Anthropic({ apiKey })
  }

  async call(opts: LLMCallOptions): Promise<LLMCallResult> {
    let message: Anthropic.Message
    try {
      message = await this.client.messages.create({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: 'user', content: toAnthropicContent(opts.userContent) }],
      })
    } catch (err) {
      const status = err instanceof Anthropic.APIError ? err.status : undefined
      const failureMode =
        status === 429 ? 'rate_limited' :
        status === 401 || status === 403 ? 'auth_error' :
        status && status >= 500 ? 'provider_outage' :
        'unknown'
      throw new LLMCallError(err instanceof Error ? err.message : 'Anthropic call failed', failureMode, status)
    }

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    return {
      text,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    }
  }
}
