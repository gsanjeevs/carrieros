// server/application/conversation-service.ts
// Dispatcher-facing aggregate message inbox — never built before (legacy or
// v1). Every prior messages capability is scoped to one load's thread.
import { roleHasCapability } from '@/lib/generated/role-capabilities'
import type { ActorContext } from '../domain/shared/identity'
import { err, forbidden, type Result } from '../domain/shared/result'
import type { ConversationRepository, ConversationSummary } from '../ports'

export class ConversationService {
  constructor(private readonly deps: { readonly conversations: ConversationRepository }) {}

  list(actor: ActorContext): Promise<Result<readonly ConversationSummary[]>> {
    if (!roleHasCapability(actor.role, 'loads_manage')) {
      return Promise.resolve(err(forbidden('This role cannot view the message inbox', { role: actor.role })))
    }
    return this.deps.conversations.listForOrg(actor)
  }
}
