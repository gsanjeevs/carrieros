// lib/ai/types.ts
// Shared provider abstraction for every LLM call in this app (decisions.md T17). Deliberately
// minimal — the only thing normalized across providers is "send this system/user(/image) content,
// get back { text, inputTokens, outputTokens }, classify a failure into one of four buckets."
// Prompt content, JSON schema description, and response parsing (strip code fences, JSON.parse,
// validate) stay exactly as lib/extract-load.ts and lib/support-triage.ts already do them — this
// module only replaces the "make one call to `@anthropic-ai/sdk` directly" mechanism.
//
// Why NOT a provider-specific structured-output feature (OpenAI's response_format: json_schema,
// Anthropic tool-use, etc.): those differ enough per provider that using each natively would give
// each provider a different reliability/failure shape, defeating the point of a swappable
// abstraction. See T17's "What the abstraction actually normalizes" note.

/** A single block of user-message content. `text` covers T16's plain-text case; `image` covers
 * T6's `extractLoadFromImage` vision case — one text block + one image block, same shape either
 * provider translates into its own wire format. */
export type LLMContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string /* base64, no data: URL prefix */ }

export interface LLMCallOptions {
  /** Provider-specific model name (e.g. 'claude-haiku-4-5', 'gpt-4o-mini'). Callers normally use
   * the resolved default from getActiveLLMProvider() rather than hardcoding one. */
  model: string
  maxTokens: number
  system: string
  /** A plain string for text-only calls (T16's triage case), or a content-block array when an
   * image needs to be attached (T6's extractLoadFromImage case). */
  userContent: string | LLMContentBlock[]
}

export interface LLMCallResult {
  text: string
  inputTokens: number
  outputTokens: number
}

export type LLMFailureMode = 'rate_limited' | 'auth_error' | 'provider_outage' | 'unknown'

/** Thrown by every provider's call() on a transport-level failure (the underlying SDK error, or a
 * missing API key). `failureMode` is the same rate_limited/auth_error/provider_outage/unknown
 * classification lib/extract-load.ts and lib/support-triage.ts already computed from Anthropic's
 * status codes — providers below classify their own SDK's status codes into the same four buckets. */
export class LLMCallError extends Error {
  failureMode: LLMFailureMode
  status?: number

  constructor(message: string, failureMode: LLMFailureMode, status?: number) {
    super(message)
    this.name = 'LLMCallError'
    this.failureMode = failureMode
    this.status = status
  }
}

/** Thrown when the resolved provider's required environment variable isn't set. Distinct from
 * LLMCallError (that's a call-time failure; this is a configuration failure, resolved before any
 * network call is attempted) so callers/observability can tell "misconfigured" apart from "the
 * provider rejected/failed the request". */
export class LLMProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LLMProviderNotConfiguredError'
  }
}

export interface LLMProvider {
  call(opts: LLMCallOptions): Promise<LLMCallResult>
}
