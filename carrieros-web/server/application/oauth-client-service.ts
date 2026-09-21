// server/application/oauth-client-service.ts
// Settings-surface CRUD for the public developer API's OAuth clients. Gated
// by the SAME capability as billing (subscription_management: owner/solo
// only) — reusing it rather than inventing a second capability that would
// mean the same thing, the precedent migration 0023 set for invoice_actions.
//
// This is administration of WHO may call the public API, not the public API
// itself — callers here are always logged-in humans with a normal
// ActorContext. Contrast with PublicApiTokenService, which authenticates the
// external caller.
import { err, forbidden, ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { OAuthClientSummary } from '../domain/oauth/model'
import type { OAuthClientRepository, OAuthCredentialProvider } from '../ports'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

export interface CreatedOAuthClient {
  readonly client: OAuthClientSummary
  /** The RAW secret. Present only on the response to THIS call — never persisted, never returned again. */
  readonly clientSecret: string
}

export class OAuthClientService {
  constructor(
    private readonly deps: {
      readonly clients: OAuthClientRepository
      readonly credentials: OAuthCredentialProvider
    }
  ) {}

  private authorize(actor: ActorContext): Result<void> {
    if (!roleHasCapability(actor.role, 'subscription_management')) {
      return err(forbidden('This role cannot manage the public API', { role: actor.role }))
    }
    return ok(undefined)
  }

  async list(actor: ActorContext): Promise<Result<readonly OAuthClientSummary[]>> {
    const authorized = this.authorize(actor)
    if (!authorized.ok) return authorized
    return this.deps.clients.listForOrg(actor.orgId)
  }

  async create(actor: ActorContext, name: string): Promise<Result<CreatedOAuthClient>> {
    const authorized = this.authorize(actor)
    if (!authorized.ok) return authorized

    const clientId = this.deps.credentials.newClientId()
    const clientSecret = this.deps.credentials.newClientSecret()
    const secretHash = await this.deps.credentials.hashSecret(clientSecret)

    const created = await this.deps.clients.create(actor.orgId, name, clientId, secretHash)
    if (!created.ok) return created

    return ok({ client: created.value, clientSecret })
  }

  async revoke(actor: ActorContext, clientId: string): Promise<Result<boolean>> {
    const authorized = this.authorize(actor)
    if (!authorized.ok) return authorized
    return this.deps.clients.revoke(actor.orgId, clientId)
  }
}
