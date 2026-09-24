import { roleHasCapability } from '@/lib/generated/role-capabilities'
import type { ActorContext } from '../domain/shared/identity'
import { domainError, err, forbidden, notFound, ok, type Result } from '../domain/shared/result'
import { languageNameFor } from '../domain/translation/languages'
import type { FeatureGate, IdempotencyRepository, MessageRepository, MessageTranslationRepository, ShipmentAccessRepository, TranslationProvider } from '../ports'
import { withIdempotency } from './idempotency'

export class DriverMessageService {
  constructor(private readonly deps: {
    readonly shipments: ShipmentAccessRepository
    readonly messages: MessageRepository
    readonly features: FeatureGate
    readonly idempotency: IdempotencyRepository
    readonly translations: MessageTranslationRepository
    readonly translator: TranslationProvider
  }) {}

  /** Load-access check shared with send(): office staff (loads_manage), or the driver assigned to this load. */
  private async authorizeLoadMessageAccess(actor: ActorContext, loadId: number): Promise<Result<true>> {
    const load = await this.deps.shipments.findForActor(actor, loadId)
    if (!load.ok) return load
    if (!load.value) return err(notFound('Load'))

    let allowed = roleHasCapability(actor.role, 'loads_manage')
    if (!allowed) {
      const driverId = await this.deps.shipments.findDriverIdForActor(actor)
      if (!driverId.ok) return driverId
      allowed = driverId.value !== null && driverId.value === load.value.driverId
    }
    if (!allowed) return err(forbidden('You do not have access to this load’s messages', { role: actor.role }))
    return { ok: true, value: true }
  }

  async send(actor: ActorContext, input: { loadId: number; body: string }, key: string): Promise<Result<{ id: number; sent_at: string }>> {
    return withIdempotency(this.deps.idempotency, actor, 'POST /driver-messages', key, input, async () => {
      const entitled = await this.deps.features.hasFeature(actor, 'driver_chat')
      if (!entitled.ok) return entitled
      if (!entitled.value) return err(domainError('ENTITLEMENT_REQUIRED', 'Driver messaging requires the Growth plan or above'))

      const access = await this.authorizeLoadMessageAccess(actor, input.loadId)
      if (!access.ok) return access

      const language = await this.deps.messages.resolveOriginalLanguage(actor)
      if (!language.ok) return language
      return this.deps.messages.send(actor, input.loadId, input.body, language.value)
    })
  }

  // Real translation (replaces the pre-existing stub route, which never
  // called any backend). Cache-then-translate: an LLM call only ever happens
  // once per (message, target language) pair, same contract the stub already
  // established — driver_message_translations is unique on that pair.
  async translate(actor: ActorContext, messageId: number, targetLanguage: string): Promise<Result<string>> {
    const entitled = await this.deps.features.hasFeature(actor, 'driver_chat')
    if (!entitled.ok) return entitled
    if (!entitled.value) return err(domainError('ENTITLEMENT_REQUIRED', 'Driver messaging requires the Growth plan or above'))

    const message = await this.deps.messages.findById(actor, messageId)
    if (!message.ok) return message
    if (!message.value) return err(notFound('Message'))

    const access = await this.authorizeLoadMessageAccess(actor, message.value.loadId)
    if (!access.ok) return access

    const cached = await this.deps.translations.findCached(messageId, targetLanguage)
    if (!cached.ok) return cached
    if (cached.value !== null) return ok(cached.value)

    const translated = await this.deps.translator.translate(message.value.body, languageNameFor(targetLanguage))
    if (!translated.ok) return translated

    return this.deps.translations.insert(messageId, targetLanguage, translated.value)
  }
}
