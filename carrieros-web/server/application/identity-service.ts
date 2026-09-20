// server/application/identity-service.ts
// "Who am I and what may I do", answered once for every client. Mobile used to
// read its own profiles row and then decide UI gating locally; this returns the
// role plus the capability list from the same generated table both apps already
// share, so gating can't drift between them.
import { ROLE_CAPABILITIES } from '../../lib/generated/role-capabilities'
import type { ActorContext } from '../domain/shared/identity'

export interface Identity {
  readonly userId: string
  readonly orgId: number
  readonly role: string
  readonly capabilities: readonly string[]
}

export class IdentityService {
  describe(actor: ActorContext): Identity {
    return {
      userId: actor.userId,
      orgId: actor.orgId,
      role: actor.role,
      capabilities: [...(ROLE_CAPABILITIES[actor.role] ?? [])],
    }
  }
}
