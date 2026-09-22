// lib/ai/anthropic-provider.ts
// Anthropic implementation of lib/ai/types.ts's LLMProvider — unchanged behavior from the
// pre-T17 direct `@anthropic-ai/sdk` calls in lib/extract-load.ts/lib/support-triage.ts, now
// reached through the abstraction instead of directly (decisions.md T17). The status->failureMode
// classification below is copied verbatim from those two files, not redesigned.
import Anthropic from '@anthropic-ai/sdk'
import type { LLMCallOptions, LLMCallResult, LLMContentBlock, LLMProvider } from './types'
import { LLMCallError, LLMProviderNotConfiguredError } from './types'

function toAnthropicContent(userContent: string | LLMContentBlock[]): Anthropic.MessageParam['content'] {
  if (typeof userContent === 'string') return userContent
  return userContent.map((block): Anthropic.ContentBlockParam => {
    if (block.type === 'text') return { type: 'text', text: block.text }
    return { type: 'image', source: { type: 'base64', media_type: block.mediaType as 'image/jpeg' | 'image/png' | 'image/webp', data: block.data } }
  })
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic

  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new LLMProviderNotConfiguredError('ANTHROPIC_API_KEY not configured')
    }
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
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
