// server/application/dvir-service.ts
// Filing a DVIR: the inspection and its defects in one atomic call, then the signature and defect
// photos as follow-up attachments that go straight to storage through signed URLs (same pattern as
// load documents). Attachments are best-effort by design: the safety record is already saved, so a
// failed photo must not lose it.
import { DVIR_AREAS, buildAttachmentPath, buildDvir, isIssuedAttachmentPath, type AttachmentKind, type DefectInput } from '../domain/compliance/dvir'
import { err, ok, validationFailed, type Result } from '../domain/shared/result'
import { forbidden, notFound } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { DvirRepository, IdGenerator, IdempotencyRepository, ObjectStorage, ShipmentAccessRepository } from '../ports'
import { withIdempotency } from './idempotency'
import { authorizeLoadAction } from './load-access'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

// Roles come from role_capabilities ('dvir_file', 'dvir_attach_any'), mirroring RLS: drivers file their
// own, owner/solo have ALL, dispatcher/finance do not file DVIRs.

export class DvirService {
  constructor(
    private readonly deps: {
      readonly shipments: ShipmentAccessRepository
      readonly dvir: DvirRepository
      readonly storage: ObjectStorage
      readonly ids: IdGenerator
      readonly idempotency: IdempotencyRepository
    }
  ) {}

  async submit(
    actor: ActorContext,
    loadId: number,
    input: { type: string; odometer?: number | null; defects: readonly DefectInput[] },
    idempotencyKey: string
  ): Promise<Result<{ id: number; defects: readonly { id: number; area: string }[] }>> {
    const draft = buildDvir(input)
    if (!draft.ok) return draft

    return withIdempotency(this.deps.idempotency, actor, `POST /loads/${loadId}/dvir-inspections`, idempotencyKey, input, async () => {
      const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, 'dvir_file', 'file an inspection')
      if (!access.ok) return access
      const { load, actorDriverId } = access.value

      // A driver files as themselves (RLS requires it); an owner-operator has no drivers row, so null.
      const driverId = actor.role === 'driver' ? actorDriverId : null
      let vehicleId = load.vehicleId
      if (vehicleId === null && actor.role === 'driver') {
        const fallback = await this.deps.dvir.findDefaultVehicle(actor)
        if (!fallback.ok) return fallback
        vehicleId = fallback.value
      }

      return this.deps.dvir.submit(actor, {
        loadId,
        vehicleId,
        driverId,
        type: draft.value.type,
        condition: draft.value.condition,
        odometer: draft.value.odometer,
        defects: draft.value.defects,
      })
    })
  }

  private async authorizeInspection(actor: ActorContext, inspectionId: number): Promise<Result<void>> {
    if (!roleHasCapability(actor.role, 'dvir_file')) return err(forbidden('This role cannot attach to an inspection', { role: actor.role }))
    const found = await this.deps.dvir.findInspection(actor, inspectionId)
    if (!found.ok) return found
    if (!found.value) return err(notFound('Inspection'))
    if (actor.role === 'driver') {
      // A driver may only attach to an inspection they filed. Anyone else's answers like a missing one.
      const own = await this.deps.shipments.findDriverIdForActor(actor)
      if (!own.ok) return own
      if (own.value === null || found.value.driverId !== own.value) return err(notFound('Inspection'))
    } else if (!roleHasCapability(actor.role, 'dvir_attach_any')) {
      return err(notFound('Inspection'))
    }
    return ok(undefined)
  }

  async requestAttachmentUpload(
    actor: ActorContext,
    inspectionId: number,
    input: { kind: AttachmentKind; area?: string | null; contentType: 'image/png' | 'image/jpeg' }
  ): Promise<Result<{ uploadUrl: string; storagePath: string; contentType: string }>> {
    const allowed = await this.authorizeInspection(actor, inspectionId)
    if (!allowed.ok) return allowed
    if (input.kind === 'defect_photo' && !(DVIR_AREAS as readonly string[]).includes(input.area ?? '')) {
      return err(validationFailed('A defect photo needs a valid area', { area: 'INVALID' }))
    }
    const path = buildAttachmentPath(actor.orgId, inspectionId, input.kind, input.area ?? null, this.deps.ids.uuid(), input.contentType === 'image/png' ? 'png' : 'jpg')
    const url = await this.deps.storage.createUploadUrl(path)
    if (!url.ok) return url
    return ok({ uploadUrl: url.value, storagePath: path, contentType: input.contentType })
  }

  async finalizeAttachment(
    actor: ActorContext,
    inspectionId: number,
    input: { kind: AttachmentKind; area?: string | null; storagePath: string },
    idempotencyKey: string
  ): Promise<Result<{ ok: true }>> {
    return withIdempotency(this.deps.idempotency, actor, `POST /dvir-inspections/${inspectionId}/attachments`, idempotencyKey, input, async () => {
      const allowed = await this.authorizeInspection(actor, inspectionId)
      if (!allowed.ok) return allowed
      const area = input.area ?? null
      if (!isIssuedAttachmentPath(input.storagePath, actor.orgId, inspectionId, input.kind, area)) {
        return err(validationFailed('That path was not issued for this inspection', { storage_path: 'NOT_ISSUED' }))
      }
      const present = await this.deps.storage.exists(input.storagePath)
      if (!present.ok) return present
      if (!present.value) return err(validationFailed('No uploaded file found at that path', { storage_path: 'UPLOAD_NOT_FOUND' }))

      const target = input.kind === 'signature' ? ({ kind: 'signature' } as const) : ({ kind: 'defect_photo', area: area as string } as const)
      const attached = await this.deps.dvir.attach(actor, inspectionId, target, input.storagePath)
      if (!attached.ok) return attached
      if (!attached.value) {
        await this.deps.storage.remove([input.storagePath])
        return err(notFound(input.kind === 'signature' ? 'Inspection' : 'Defect'))
      }
      return ok({ ok: true as const })
    })
  }
}
