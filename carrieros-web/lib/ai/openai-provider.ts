// lib/ai/openai-provider.ts
// OpenAI implementation of lib/ai/types.ts's LLMProvider (decisions.md T17) — the new default
// provider. Uses the standard chat completions API. Failure classification mirrors the Anthropic
// provider's status->failureMode mapping exactly (429/401|403/5xx/unknown), just against
// OpenAI.APIError instead of Anthropic.APIError.
//
// Key resolution (T17's 2026-09-22 amendment): same pattern as anthropic-provider.ts — the
// constructor takes the ai_provider_config row's `openai_api_key_encrypted` value and decrypts it
// here (the only place decryption happens for this provider), falling back to OPENAI_API_KEY when
// unset.
import OpenAI from 'openai'
import type { LLMCallOptions, LLMCallResult, LLMContentBlock, LLMProvider } from './types'
import { LLMCallError, LLMProviderNotConfiguredError } from './types'
import { decryptSecret } from '../crypto/secrets'

export function toOpenAIContent(userContent: string | LLMContentBlock[]): string | OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  if (typeof userContent === 'string') return userContent
  return userContent.map((block): OpenAI.Chat.Completions.ChatCompletionContentPart => {
    if (block.type === 'text') return { type: 'text', text: block.text }
    return { type: 'image_url', image_url: { url: `data:${block.mediaType};base64,${block.data}` } }
  })
}

export function classifyOpenAIError(err: unknown): { message: string; status?: number; failureMode: 'rate_limited' | 'auth_error' | 'provider_outage' | 'unknown' } {
  const status = err instanceof OpenAI.APIError ? err.status : undefined
  const failureMode =
    status === 429 ? 'rate_limited' as const :
    status === 401 || status === 403 ? 'auth_error' as const :
    status && status >= 500 ? 'provider_outage' as const :
    'unknown' as const
  return { message: err instanceof Error ? err.message : 'OpenAI call failed', status, failureMode }
}

export class OpenAIProvider implements LLMProvider {
  protected client: OpenAI

  constructor(encryptedApiKey?: string | null) {
    const apiKey = encryptedApiKey ? decryptSecret(encryptedApiKey) : process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new LLMProviderNotConfiguredError('OPENAI_API_KEY not configured')
    }
    this.client = new OpenAI({ apiKey })
  }

  async call(opts: LLMCallOptions): Promise<LLMCallResult> {
    let completion: OpenAI.Chat.Completions.ChatCompletion
    try {
      completion = await this.client.chat.completions.create({
        model: opts.model,
        max_tokens: opts.maxTokens,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: toOpenAIContent(opts.userContent) },
        ],
      })
    } catch (err) {
      const { message, status, failureMode } = classifyOpenAIError(err)
      throw new LLMCallError(message, failureMode, status)
    }

    return {
      text: completion.choices[0]?.message?.content ?? '',
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    }
  }
}
