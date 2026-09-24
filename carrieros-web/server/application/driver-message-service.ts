import { roleHasCapability } from '@/lib/generated/role-capabilities'
import type { ActorContext } from '../domain/shared/identity'
import { domainError, err, forbidden, notFound, type Result } from '../domain/shared/result'
import type { FeatureGate, IdempotencyRepository, MessageRepository, ShipmentAccessRepository } from '../ports'
import { withIdempotency } from './idempotency'

export class DriverMessageService {
  constructor(private readonly deps: {
    readonly shipments: ShipmentAccessRepository
    readonly messages: MessageRepository
    readonly features: FeatureGate
    readonly idempotency: IdempotencyRepository
  }) {}

  async send(actor: ActorContext, input: { loadId: number; body: string }, key: string): Promise<Result<{ id: number; sent_at: string }>> {
    return withIdempotency(this.deps.idempotency, actor, 'POST /driver-messages', key, input, async () => {
      const entitled = await this.deps.features.hasFeature(actor, 'driver_chat')
      if (!entitled.ok) return entitled
      if (!entitled.value) return err(domainError('ENTITLEMENT_REQUIRED', 'Driver messaging requires the Growth plan or above'))

      const load = await this.deps.shipments.findForActor(actor, input.loadId)
      if (!load.ok) return load
      if (!load.value) return err(notFound('Load'))

      let allowed = roleHasCapability(actor.role, 'loads_manage')
      if (!allowed) {
        const driverId = await this.deps.shipments.findDriverIdForActor(actor)
        if (!driverId.ok) return driverId
        allowed = driverId.value !== null && driverId.value === load.value.driverId
      }
      if (!allowed) return err(forbidden('You do not have access to this load’s messages', { role: actor.role }))

      const language = await this.deps.messages.resolveOriginalLanguage(actor)
      if (!language.ok) return language
      return this.deps.messages.send(actor, input.loadId, input.body, language.value)
    })
  }
}
