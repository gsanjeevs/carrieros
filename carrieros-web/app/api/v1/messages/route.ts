// GET /api/v1/messages — dispatcher-facing aggregate inbox: every load's
// message thread, newest activity first, with unread counts. Never built
// before (legacy or v1) — every prior messages capability is scoped to one
// load's thread.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createConversationService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { ListConversationsResponseSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const actor = await buildActorContext(authed.supabase, authed.user, request.headers.get('x-request-id') ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createConversationService(authed.supabase).list(actor.value)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(ListConversationsResponseSchema.parse({
    conversations: result.value.map((c) => ({
      load_id: c.loadId,
      load_number: c.loadNumber,
      last_message_body: c.lastMessageBody,
      last_message_at: c.lastMessageAt,
      unread_count: c.unreadCount,
    })),
  }))
}
