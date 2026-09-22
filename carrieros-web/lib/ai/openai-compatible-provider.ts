// lib/ai/openai-compatible-provider.ts
// "Any OpenAI-compatible endpoint" provider (decisions.md T17) — the pragmatic answer to "and open
// source": nearly every self-hosted/open-source inference server (Ollama, vLLM, LM Studio) and
// aggregator (OpenRouter, Together, Groq) speaks the OpenAI wire format, so this one adapter covers
// all of them via the `openai` SDK's native `baseURL` override, rather than a bespoke SDK per
// project.
//
// Differs from OpenAIProvider in exactly two ways: (1) constructed with a caller-supplied
// baseURL, and (2) the API key is OPTIONAL — many self-hosted endpoints require none at all, so
// this is the one provider type that must NOT throw "not configured" for a missing key. It DOES
// throw for a missing base URL, since there is no sensible default to fall back to.
//
// Key resolution (T17's 2026-09-22 amendment): same DB-first, env-fallback order as the other two
// providers, decrypted here (the only place decryption happens for this provider) — but since the
// key stays optional, an absent value on both sides is not an error, unlike anthropic/openai.
import OpenAI from 'openai'
import type { LLMCallOptions, LLMCallResult, LLMProvider } from './types'
import { LLMCallError, LLMProviderNotConfiguredError } from './types'
import { classifyOpenAIError, toOpenAIContent } from './openai-provider'
import { decryptSecret } from '../crypto/secrets'

export class OpenAICompatibleProvider implements LLMProvider {
  private client: OpenAI

  constructor(baseURL: string | null | undefined, encryptedApiKey?: string | null) {
    if (!baseURL) {
      throw new LLMProviderNotConfiguredError('compatible_base_url not configured for openai_compatible provider')
    }
    // OPENAI_COMPATIBLE_API_KEY is optional by design -- see header comment. The `openai` SDK
    // requires SOME string for `apiKey`, so an unset key becomes an empty placeholder rather than
    // a thrown error; self-hosted endpoints that don't check the Authorization header ignore it.
    const apiKey = encryptedApiKey ? decryptSecret(encryptedApiKey) : process.env.OPENAI_COMPATIBLE_API_KEY
    this.client = new OpenAI({ apiKey: apiKey || 'not-required', baseURL })
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
