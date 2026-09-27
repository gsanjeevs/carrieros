// server/application/telematics-service.ts
// Settings-surface CRUD for org-level telematics vendor credentials (Settings
// > Integrations > Telematics). Gated by the SAME capability as
// webhooks/billing/developer-api (subscription_management: owner/solo only)
// -- a Samsara API key or Motive webhook secret is exactly the kind of
// "who may configure org-wide integrations" credential that capability
// already exists for.
//
// Encryption happens HERE, not in the repository or the route: this is the
// one place a plaintext credential is in memory for this feature, mirroring
// app/api/admin/ai-config/route.ts's PUT handler encrypting before its
// `.update()` call. The repository only ever sees/stores ciphertext.
import { encryptSecret } from '@/lib/crypto/secrets'
import { err, forbidden, ok, validationFailed, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import { isTelematicsProvider, type TelematicsIntegrationSummary, type TelematicsProvider } from '../domain/telematics/model'
import type { TelematicsIntegrationRepository } from '../ports'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

export interface UpsertTelematicsIntegrationInput {
  readonly provider: string
  readonly enabled?: boolean
  /** Samsara only. undefined = leave untouched, null = clear, non-empty string = (re)set. */
  readonly apiKey?: string | null
  /** Motive only. Same undefined/null/string convention as apiKey. */
  readonly webhookSecret?: string | null
}

export class TelematicsIntegrationService {
  constructor(private readonly deps: { readonly integrations: TelematicsIntegrationRepository }) {}

  private authorize(actor: ActorContext): Result<void> {
    if (!roleHasCapability(actor.role, 'subscription_management')) {
      return err(forbidden('This role cannot manage integrations', { role: actor.role }))
    }
    return ok(undefined)
  }

  async list(actor: ActorContext): Promise<Result<readonly TelematicsIntegrationSummary[]>> {
    const authorized = this.authorize(actor)
    if (!authorized.ok) return authorized
    return this.deps.integrations.listForOrg(actor)
  }

  async upsert(actor: ActorContext, input: UpsertTelematicsIntegrationInput): Promise<Result<TelematicsIntegrationSummary>> {
    const authorized = this.authorize(actor)
    if (!authorized.ok) return authorized

    if (!isTelematicsProvider(input.provider)) {
      return err(validationFailed('provider must be "samsara" or "motive"', { provider: 'INVALID' }))
    }
    const provider: TelematicsProvider = input.provider

    if (provider === 'samsara' && input.webhookSecret !== undefined) {
      return err(validationFailed('webhookSecret does not apply to samsara -- use apiKey', { webhookSecret: 'NOT_APPLICABLE' }))
    }
    if (provider === 'motive' && input.apiKey !== undefined) {
      return err(validationFailed('apiKey does not apply to motive -- use webhookSecret', { apiKey: 'NOT_APPLICABLE' }))
    }

    // First-time setup for a provider must include its credential -- the table's CHECK constraint
    // requires exactly one non-null credential column per row, so an insert with neither would fail
    // at the DB anyway; catching it here produces a real VALIDATION_ERROR instead of a raw DB error.
    const existing = await this.deps.integrations.listForOrg(actor)
    if (!existing.ok) return existing
    const hasExistingRow = existing.value.some((row) => row.provider === provider)
    const credentialValue = provider === 'samsara' ? input.apiKey : input.webhookSecret
    if (!hasExistingRow && (credentialValue === undefined || credentialValue === null || credentialValue.trim() === '')) {
      const field = provider === 'samsara' ? 'apiKey' : 'webhookSecret'
      return err(validationFailed(`${field} is required to set up ${provider} for the first time`, { [field]: 'REQUIRED' }))
    }

    const encryptedApiKey =
      input.apiKey === undefined ? undefined : input.apiKey === null || input.apiKey.trim() === '' ? null : encryptSecret(input.apiKey.trim())
    const encryptedWebhookSecret =
      input.webhookSecret === undefined
        ? undefined
        : input.webhookSecret === null || input.webhookSecret.trim() === ''
          ? null
          : encryptSecret(input.webhookSecret.trim())

    return this.deps.integrations.upsert(actor, provider, {
      apiKeyEncrypted: encryptedApiKey,
      webhookSecretEncrypted: encryptedWebhookSecret,
      enabled: input.enabled,
    })
  }
}
