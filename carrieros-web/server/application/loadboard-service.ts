// server/application/loadboard-service.ts
// DAT load-board integration, Phase 1 (posting only, mocked DAT client -- user request, 2026-09-27).
// Two services, split the same way webhooks split into WebhookService (Settings CRUD) and
// WebhookDispatchService (the actual outbound action) in webhook-dispatch-service.ts:
//   - LoadboardIntegrationService: Settings > Integrations > Load Board CRUD for the org's DAT
//     credential. Encryption happens HERE (see telematics-service.ts's header comment for why: this
//     is the one place a plaintext credential is in memory for this feature).
//   - LoadboardPostingService: the load-detail "Post to DAT" action -- loads the load, decrypts the
//     org's credential, calls the injected DatClient, and records the result.
//
// Both are gated by the SAME `loadboard_posting` capability (owner/solo/dispatcher) AND the
// `loadboard_posting` Growth+ feature gate -- unlike telematics-service.ts, which only checks a
// capability. DAT posting is a paid tier feature (BRD-style Growth+ gate, same features/has_feature()
// model as every other gated feature), not just a role restriction, so authorize() here is async and
// checks both.
import { encryptSecret, decryptSecret } from '@/lib/crypto/secrets'
import { domainError, err, forbidden, notFound, ok, validationFailed, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import {
  isLoadboardProvider,
  type LoadboardIntegrationSummary,
  type LoadboardPostingSummary,
  type LoadboardProvider,
} from '../domain/loadboard/model'
import type { DatClient, FeatureGate, LoadboardIntegrationRepository, LoadboardPostingRepository } from '../ports'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

const LOADBOARD_CAPABILITY = 'loadboard_posting'
const LOADBOARD_FEATURE = 'loadboard_posting'

export interface UpsertLoadboardIntegrationInput {
  readonly provider: string
  readonly enabled?: boolean
  /** undefined = leave untouched, null = clear, non-empty string = (re)set. Same convention as
   * telematics-service.ts's UpsertTelematicsIntegrationInput. */
  readonly apiKey?: string | null
}

/** Shared by both services below -- identical capability+entitlement check either gates. */
async function authorize(actor: ActorContext, features: FeatureGate): Promise<Result<void>> {
  if (!roleHasCapability(actor.role, LOADBOARD_CAPABILITY)) {
    return err(forbidden('This role cannot manage the load board', { role: actor.role }))
  }
  const entitled = await features.hasFeature(actor, LOADBOARD_FEATURE)
  if (!entitled.ok) return entitled
  if (!entitled.value) {
    return err(domainError('ENTITLEMENT_REQUIRED', 'Load board posting requires the Growth plan or higher'))
  }
  return ok(undefined)
}

export class LoadboardIntegrationService {
  constructor(
    private readonly deps: {
      readonly integrations: LoadboardIntegrationRepository
      readonly features: FeatureGate
    }
  ) {}

  async list(actor: ActorContext): Promise<Result<readonly LoadboardIntegrationSummary[]>> {
    const authorized = await authorize(actor, this.deps.features)
    if (!authorized.ok) return authorized
    return this.deps.integrations.listForOrg(actor)
  }

  async upsert(actor: ActorContext, input: UpsertLoadboardIntegrationInput): Promise<Result<LoadboardIntegrationSummary>> {
    const authorized = await authorize(actor, this.deps.features)
    if (!authorized.ok) return authorized

    if (!isLoadboardProvider(input.provider)) {
      return err(validationFailed('provider must be "dat"', { provider: 'INVALID' }))
    }
    const provider: LoadboardProvider = input.provider

    // First-time setup must include the credential -- same reasoning as telematics-service.ts: catch
    // it here for a real VALIDATION_ERROR instead of relying on a DB-level failure.
    const existing = await this.deps.integrations.listForOrg(actor)
    if (!existing.ok) return existing
    const hasExistingRow = existing.value.some((row) => row.provider === provider)
    if (!hasExistingRow && (input.apiKey === undefined || input.apiKey === null || input.apiKey.trim() === '')) {
      return err(validationFailed('apiKey is required to set up DAT for the first time', { apiKey: 'REQUIRED' }))
    }

    const encryptedApiKey =
      input.apiKey === undefined ? undefined : input.apiKey === null || input.apiKey.trim() === '' ? null : encryptSecret(input.apiKey.trim())

    return this.deps.integrations.upsert(actor, provider, {
      apiKeyEncrypted: encryptedApiKey,
      enabled: input.enabled,
    })
  }
}

export class LoadboardPostingService {
  constructor(
    private readonly deps: {
      readonly integrations: LoadboardIntegrationRepository
      readonly postings: LoadboardPostingRepository
      readonly features: FeatureGate
      readonly datClient: DatClient
    }
  ) {}

  async getPostingStatus(actor: ActorContext, loadId: number, provider: LoadboardProvider = 'dat'): Promise<Result<LoadboardPostingSummary | null>> {
    const authorized = await authorize(actor, this.deps.features)
    if (!authorized.ok) return authorized
    return this.deps.postings.getForLoad(actor, loadId, provider)
  }

  async postLoad(actor: ActorContext, loadId: number, provider: string = 'dat'): Promise<Result<LoadboardPostingSummary>> {
    const authorized = await authorize(actor, this.deps.features)
    if (!authorized.ok) return authorized

    if (!isLoadboardProvider(provider)) {
      return err(validationFailed('provider must be "dat"', { provider: 'INVALID' }))
    }

    const load = await this.deps.postings.getLoadForPosting(actor, loadId)
    if (!load.ok) return load
    if (!load.value) return err(notFound('Load not found'))

    const alreadyPosted = await this.deps.postings.getForLoad(actor, loadId, provider)
    if (!alreadyPosted.ok) return alreadyPosted
    if (alreadyPosted.value) {
      return err(validationFailed('This load has already been posted to this provider', { provider: 'ALREADY_POSTED' }))
    }

    const credential = await this.deps.integrations.getCredential(actor, provider)
    if (!credential.ok) return credential
    if (!credential.value || !credential.value.enabled || !credential.value.apiKeyEncrypted) {
      return err(validationFailed('DAT is not configured for this organization yet', { provider: 'NOT_CONFIGURED' }))
    }
    // Decrypted here, in memory, only for the duration of this one outbound call -- never logged,
    // never stored, never returned. MockDatClient (Phase 1) ignores it entirely; a real DatClient
    // would use it as the Bearer/API-key credential on the outbound HTTP call.
    decryptSecret(credential.value.apiKeyEncrypted)

    const result = await this.deps.datClient.postLoad({
      loadId,
      originCity: load.value.pickupCity,
      originState: load.value.pickupState,
      destinationCity: load.value.deliveryCity,
      destinationState: load.value.deliveryState,
      pickupDate: load.value.pickupDate,
      equipmentType: null,
      weightLbs: load.value.weightLbs,
      rate: load.value.rate,
    })

    return this.deps.postings.create(actor, loadId, provider, result)
  }
}
