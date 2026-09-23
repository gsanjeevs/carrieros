// server/application/public-api-token-service.ts
// The client-credentials grant itself: verify a client_id/client_secret pair
// and decide whether to mint claims for a token. No JWT signing here — that
// is a pure crypto/env-var concern that lives in lib/public-api-auth.ts
// (parallel to how lib/api-auth.ts owns session-token verification), kept
// out of the application layer per Rule D (no Next.js/crypto-library
// coupling in server/application).
import { domainError, err, ok, type Result } from '../domain/shared/result'
import type { OrgId } from '../domain/shared/identity'
import type { OAuthClientRepository, OAuthCredentialProvider, PublicApiEntitlementGate, PublicApiRateLimiter } from '../ports'

export interface IssuedTokenClaims {
  readonly orgId: OrgId
  readonly clientId: string
  readonly scope: 'read'
}

export class PublicApiTokenService {
  constructor(
    private readonly deps: {
      readonly clients: OAuthClientRepository
      readonly credentials: OAuthCredentialProvider
      readonly entitlements: PublicApiEntitlementGate
      readonly rateLimiter: PublicApiRateLimiter
    }
  ) {}

  async issueToken(input: { clientId: string; clientSecret: string }): Promise<Result<IssuedTokenClaims>> {
    if (!input.clientId || !input.clientSecret) {
      return err(domainError('VALIDATION_FAILED', 'client_id and client_secret are required'))
    }

    // Rate-limited by the CLAIMED client_id before any credential work, so repeated secret guesses
    // against one client_id are throttled the same as legitimate traffic — not only successful calls.
    const limited = await this.deps.rateLimiter.checkAndIncrement(input.clientId)
    if (!limited.ok) return limited
    if (!limited.value.allowed) {
      return err(domainError('LIMIT_EXCEEDED', 'Too many token requests', { meta: { retryAfterSeconds: limited.value.retryAfterSeconds } }))
    }

    const found = await this.deps.clients.findActiveByClientId(input.clientId)
    if (!found.ok) return found

    // Unknown client_id, revoked client, and wrong secret all return the identical error — never tell an
    // unauthenticated caller which of those is true (that alone would leak whether a client_id exists).
    if (!found.value || found.value.revokedAt !== null) {
      return err(domainError('FORBIDDEN', 'Invalid client credentials'))
    }
    const validSecret = await this.deps.credentials.verifySecret(input.clientSecret, found.value.clientSecretHash)
    if (!validSecret) {
      return err(domainError('FORBIDDEN', 'Invalid client credentials'))
    }

    // Tier re-verified HERE at token-issue time, in case the org downgraded after this client was
    // created. Deliberately NOT re-checked again for the token's 1h lifetime — see
    // lib/public-api-auth.ts's header comment for why that window is an accepted v1 scope cut, not a gap.
    const entitlement = await this.deps.entitlements.checkPublicApiAccess(found.value.orgId)
    if (!entitlement.ok) return entitlement
    if (!entitlement.value.allowed) {
      return err(
        domainError('ENTITLEMENT_REQUIRED', `Public API requires the Growth plan or above (${entitlement.value.reason})`, {
          meta: { reason: entitlement.value.reason },
        })
      )
    }

    await this.deps.clients.markUsed(input.clientId)

    return ok({ orgId: found.value.orgId, clientId: input.clientId, scope: 'read' })
  }
}
