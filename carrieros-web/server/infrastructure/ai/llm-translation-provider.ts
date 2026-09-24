// server/infrastructure/ai/llm-translation-provider.ts
// Real translation, replacing the pre-existing stub at
// app/api/driver-messages/[id]/translate/route.ts (which never called any
// backend — the decision of which one was genuinely undecided, per that
// route's own TODO comment). Reuses the platform-wide LLM provider
// abstraction (lib/ai/, decisions.md T17) already used by load-photo
// extraction and support triage — no new vendor integration.
import { getActiveLLMProvider, LLMCallError, LLMProviderNotConfiguredError } from '@/lib/ai'
import { logError } from '@/lib/observability'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { TranslationProvider } from '../../ports'

const MAX_TOKENS = 1024

export class LlmTranslationProvider implements TranslationProvider {
  async translate(text: string, targetLanguageName: string): Promise<Result<string>> {
    let active: Awaited<ReturnType<typeof getActiveLLMProvider>>
    try {
      active = await getActiveLLMProvider()
    } catch (e) {
      if (e instanceof LLMProviderNotConfiguredError) return err(domainError('TRANSLATION_FAILED', 'Translation is not configured'))
      throw e
    }

    try {
      const result = await active.provider.call({
        model: active.model,
        system: `Translate the user's message into ${targetLanguageName}. Reply with ONLY the translated text — no quotes, no explanation, no original text.`,
        maxTokens: MAX_TOKENS,
        userContent: text,
      })
      return ok(result.text.trim())
    } catch (e) {
      if (e instanceof LLMCallError) {
        logError({ route: 'driver-messages/translate' }, e.message, { failureMode: e.failureMode })
        return err(domainError('TRANSLATION_FAILED', 'Translation is temporarily unavailable'))
      }
      throw e
    }
  }
}
