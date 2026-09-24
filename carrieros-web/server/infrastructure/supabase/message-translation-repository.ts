// server/infrastructure/supabase/message-translation-repository.ts
// driver_message_translations cache, through the CALLER'S client (RLS
// mirrors driver_messages access — a caller who can read the message can
// cache/read its translation). Unique on (message_id, target_language), same
// as the legacy stub route this replaces.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { MessageTranslationRepository } from '../../ports'

export class SupabaseMessageTranslationRepository implements MessageTranslationRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async findCached(messageId: number, targetLanguage: string): Promise<Result<string | null>> {
    const { data, error } = await this.supabase
      .from('driver_message_translations')
      .select('translated_body')
      .eq('message_id', messageId)
      .eq('target_language', targetLanguage)
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `translation cache lookup failed: ${error.message}`))
    return ok(data?.translated_body ?? null)
  }

  async insert(messageId: number, targetLanguage: string, translatedBody: string): Promise<Result<string>> {
    const { data, error } = await this.supabase
      .from('driver_message_translations')
      .insert({ message_id: messageId, target_language: targetLanguage, translated_body: translatedBody })
      .select('translated_body')
      .single()
    if (error || !data) return err(domainError('PRECONDITION_FAILED', `translation insert failed: ${error?.message ?? 'No row returned'}`))
    return ok(data.translated_body)
  }
}
