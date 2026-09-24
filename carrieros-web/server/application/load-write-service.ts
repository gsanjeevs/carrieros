import { roleHasCapability } from '@/lib/generated/role-capabilities'
import { buildLoadAssignment, type LoadAssignmentInput } from '../domain/load/write'
import { err, forbidden, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { CreateLoadRecord, FeatureGate, IdempotencyRepository, LoadWriteRepository, PushNotificationGateway } from '../ports'
import { withIdempotency } from './idempotency'

export type CreateLoadInput = Partial<Omit<CreateLoadRecord, 'intake_method'>> & { readonly intake_method?: string | null }

export class LoadWriteService {
  constructor(private readonly deps: {
    readonly loads: LoadWriteRepository
    readonly features: FeatureGate
    readonly notifications: PushNotificationGateway
    readonly idempotency: IdempotencyRepository
  }) {}

  async create(actor: ActorContext, input: CreateLoadInput, idempotencyKey: string): Promise<Result<{ loadNumber: string }>> {
    if (!roleHasCapability(actor.role, 'loads_manage')) return err(forbidden('This role cannot create loads', { role: actor.role }))
    const record: CreateLoadRecord = {
      customer_name_raw: input.customer_name_raw ?? null,
      pickup_address: input.pickup_address ?? null,
      pickup_city: input.pickup_city ?? null,
      pickup_state: input.pickup_state ?? null,
      pickup_zip: input.pickup_zip ?? null,
      pickup_date: input.pickup_date ?? null,
      pickup_time: input.pickup_time ?? null,
      delivery_address: input.delivery_address ?? null,
      delivery_city: input.delivery_city ?? null,
      delivery_state: input.delivery_state ?? null,
      delivery_zip: input.delivery_zip ?? null,
      delivery_date: input.delivery_date ?? null,
      delivery_time: input.delivery_time ?? null,
      commodity: input.commodity ?? null,
      weight_lbs: input.weight_lbs ?? null,
      rate: input.rate ?? null,
      total_miles: input.total_miles ?? null,
      intake_method: input.intake_method ?? 'manual',
      raw_intake_text: input.raw_intake_text ?? null,
    }
    return withIdempotency(this.deps.idempotency, actor, 'POST /loads', idempotencyKey, input, async () => {
      const created = await this.deps.loads.create(actor, record)
      if (!created.ok) return created
      return { ok: true as const, value: { loadNumber: created.value.loadNumber } }
    })
  }

  async assign(actor: ActorContext, loadId: number, input: LoadAssignmentInput, idempotencyKey: string): Promise<Result<{
    outcome: 'APPLIED' | 'REPLAYED'
    loadId: number
    iftaMileageComplete?: boolean | null
  }>> {
    if (!roleHasCapability(actor.role, 'loads_manage')) return err(forbidden('This role cannot assign loads', { role: actor.role }))
    const patch = buildLoadAssignment(input)
    if (!patch.ok) return patch

    return withIdempotency<{ outcome: 'APPLIED' | 'REPLAYED'; loadId: number; iftaMileageComplete?: boolean | null }>(this.deps.idempotency, actor, `PATCH /loads/${loadId}`, idempotencyKey, input, async () => {
      const updated = await this.deps.loads.assign(actor, loadId, patch.value)
      if (!updated.ok) return updated
      if (!updated.value) return { ok: false as const, error: { code: 'NOT_FOUND' as const, detail: 'Load not found' } }

      if (patch.value.status) {
        const event = await this.deps.loads.appendStatusEvent(actor, loadId, patch.value.status)
        if (!event.ok) return event
      }

      if (patch.value.status === 'dispatched') {
        const recipient = await this.deps.loads.dispatchRecipient(actor, loadId)
        if (!recipient.ok) return recipient
        if (recipient.value?.pushToken) {
          void this.deps.notifications.send({
            to: recipient.value.pushToken,
            title: 'New load assigned',
            body: `You've been dispatched on load ${recipient.value.loadNumber}.`,
            data: { loadId },
          }).catch(() => {})
        }
      }

      let iftaMileageComplete: boolean | null | undefined
      if (patch.value.status === 'delivered') {
        const entitled = await this.deps.features.hasFeature(actor, 'ifta_mileage_log')
        if (!entitled.ok) return entitled
        if (entitled.value) {
          const completeness = await this.deps.loads.iftaMileageComplete(actor, loadId)
          if (!completeness.ok) return completeness
          iftaMileageComplete = completeness.value
        }
      }
      return { ok: true as const, value: { outcome: 'APPLIED' as const, loadId, ...(iftaMileageComplete !== undefined ? { iftaMileageComplete } : {}) } }
    }, { mapReplay: (stored) => ({ ...stored, outcome: 'REPLAYED' }) })
  }
}
