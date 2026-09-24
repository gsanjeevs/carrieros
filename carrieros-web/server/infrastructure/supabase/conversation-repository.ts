// server/infrastructure/supabase/conversation-repository.ts
// Through the CALLER'S client — list_message_conversations() (migration 0035)
// is deliberately not SECURITY DEFINER, so driver_messages RLS still decides
// which rows are visible, same as every other read in this codebase.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { ConversationRepository, ConversationSummary } from '../../ports'

export class SupabaseConversationRepository implements ConversationRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listForOrg(_actor: ActorContext): Promise<Result<readonly ConversationSummary[]>> {
    const { data, error } = await this.supabase.rpc('list_message_conversations')
    if (error) return err(domainError('PRECONDITION_FAILED', `conversation list failed: ${error.message}`))
    const rows = (data ?? []) as unknown as Array<{
      load_id: number; load_number: string; last_message_body: string; last_message_at: string; unread_count: number
    }>
    return ok(rows.map((r) => ({
      loadId: Number(r.load_id),
      loadNumber: r.load_number,
      lastMessageBody: r.last_message_body,
      lastMessageAt: r.last_message_at,
      unreadCount: Number(r.unread_count),
    })))
  }
}
