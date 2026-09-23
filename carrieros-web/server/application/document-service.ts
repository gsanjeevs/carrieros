// server/application/document-service.ts
// Attaching files (proof of delivery, ...) to a load, in three steps so the bytes
// never pass through the API:
//   1. requestUpload  -> server picks the path, returns a signed URL for it
//   2. (client PUTs the bytes straight to storage)
//   3. finalize       -> server verifies the object exists at THAT path, then records it
// plus a list that hands back short-lived download URLs.
//
// Who may act mirrors the intent of today's rules but is stricter than the RLS behind
// them, which lets any org member attach a document to any load in the org.
import { DOCUMENT_TYPES, buildStoragePath, isIssuedPath, type DocumentType, type UploadContentType } from '../domain/documents/upload'
import { err, ok, validationFailed, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { DocumentRecord, DocumentRepository, IdGenerator, IdempotencyRepository, ObjectStorage, ShipmentAccessRepository } from '../ports'
import { withIdempotency } from './idempotency'
import { authorizeLoadAction } from './load-access'

const DOWNLOAD_TTL_SECONDS = 3600

export interface UploadIntent {
  readonly uploadUrl: string
  readonly storagePath: string
  readonly contentType: string
}

export class DocumentService {
  constructor(
    private readonly deps: {
      readonly shipments: ShipmentAccessRepository
      readonly documents: DocumentRepository
      readonly storage: ObjectStorage
      readonly ids: IdGenerator
      readonly idempotency: IdempotencyRepository
    }
  ) {}

  async requestUpload(
    actor: ActorContext,
    loadId: number,
    input: { type: DocumentType; contentType: UploadContentType }
  ): Promise<Result<UploadIntent>> {
    const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, 'documents_upload', 'upload a document')
    if (!access.ok) return access

    const storagePath = buildStoragePath(actor.orgId, loadId, input.type, this.deps.ids.uuid(), input.contentType)
    const url = await this.deps.storage.createUploadUrl(storagePath)
    if (!url.ok) return url
    return ok({ uploadUrl: url.value, storagePath, contentType: input.contentType })
  }

  async finalize(
    actor: ActorContext,
    loadId: number,
    input: { type: DocumentType; storagePath: string },
    idempotencyKey: string
  ): Promise<Result<DocumentRecord>> {
    return withIdempotency(this.deps.idempotency, actor, `POST /loads/${loadId}/documents`, idempotencyKey, input, async () => {
      const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, 'documents_upload', 'attach a document')
      if (!access.ok) return access

      // A client may only claim a path this system issued for this org, load and type.
      if (!isIssuedPath(input.storagePath, actor.orgId, loadId, input.type)) {
        return err(validationFailed('That path was not issued for this load', { storage_path: 'NOT_ISSUED' }))
      }

      // Natural-key idempotency: finalizing the same object twice (with different keys) yields one row.
      const existing = await this.deps.documents.findByPath(actor, input.storagePath)
      if (!existing.ok) return existing
      if (existing.value) return ok(existing.value)

      const present = await this.deps.storage.exists(input.storagePath)
      if (!present.ok) return present
      if (!present.value) return err(validationFailed('No uploaded file found at that path', { storage_path: 'UPLOAD_NOT_FOUND' }))

      const created = await this.deps.documents.insert(actor, { loadId, type: input.type, storagePath: input.storagePath })
      if (!created.ok) {
        // Don't strand an object no row points at. Best effort, like the client rollback it replaces.
        await this.deps.storage.remove([input.storagePath])
        return created
      }
      return created
    })
  }

  async list(actor: ActorContext, loadId: number, type: DocumentType): Promise<Result<readonly (DocumentRecord & { url: string | null })[]>> {
    if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) return err(validationFailed('Unknown document type', { type: 'INVALID' }))
    const access = await authorizeLoadAction(this.deps.shipments, actor, loadId, 'documents_read', 'view documents')
    if (!access.ok) return access

    const rows = await this.deps.documents.listForLoad(actor, loadId, type)
    if (!rows.ok) return rows
    const withUrls = await Promise.all(
      rows.value.map(async (row) => {
        const url = await this.deps.storage.createDownloadUrl(row.storagePath, DOWNLOAD_TTL_SECONDS)
        return { ...row, url: url.ok ? url.value : null }
      })
    )
    return ok(withUrls)
  }
}
