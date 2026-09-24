// server/application/org-document-service.ts
// Company-level compliance documents (COI, MC authority, DOT cert, UCR, W-9,
// business license) — never built before as an API, legacy or v1. The
// org_documents table/RLS/storage convention already exist for the web app
// (components/CompanyDocuments.tsx); this is the same three-step upload
// pattern as DocumentService (request -> client PUTs bytes -> finalize),
// scoped to the org instead of a load.
import { roleHasCapability } from '@/lib/generated/role-capabilities'
import { buildOrgStoragePath, isIssuedOrgPath, ORG_DOC_TYPES, type OrgDocType, type OrgUploadContentType } from '../domain/documents/org-upload'
import { err, forbidden, ok, validationFailed, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { IdGenerator, ObjectStorage, OrgDocumentRecord, OrgDocumentRepository } from '../ports'

const DOWNLOAD_TTL_SECONDS = 3600

export interface OrgUploadIntent {
  readonly uploadUrl: string
  readonly storagePath: string
  readonly contentType: string
}

export class OrgDocumentService {
  constructor(
    private readonly deps: {
      readonly documents: OrgDocumentRepository
      readonly storage: ObjectStorage
      readonly ids: IdGenerator
    }
  ) {}

  async requestUpload(actor: ActorContext, input: { docType: OrgDocType; contentType: OrgUploadContentType }): Promise<Result<OrgUploadIntent>> {
    if (!roleHasCapability(actor.role, 'org_documents_manage')) return err(forbidden('This role cannot upload company documents', { role: actor.role }))

    const storagePath = buildOrgStoragePath(actor.orgId, input.docType, this.deps.ids.uuid(), input.contentType)
    const url = await this.deps.storage.createUploadUrl(storagePath)
    if (!url.ok) return url
    return ok({ uploadUrl: url.value, storagePath, contentType: input.contentType })
  }

  async finalize(actor: ActorContext, input: { docType: OrgDocType; storagePath: string; expiryDate: string | null }): Promise<Result<OrgDocumentRecord>> {
    if (!roleHasCapability(actor.role, 'org_documents_manage')) return err(forbidden('This role cannot upload company documents', { role: actor.role }))

    if (!isIssuedOrgPath(input.storagePath, actor.orgId, input.docType)) {
      return err(validationFailed('That path was not issued for this organization', { storage_path: 'NOT_ISSUED' }))
    }

    // Natural-key idempotency: finalizing the same object twice yields one row.
    const existing = await this.deps.documents.findByPath(actor, input.storagePath)
    if (!existing.ok) return existing
    if (existing.value) return ok(existing.value)

    const present = await this.deps.storage.exists(input.storagePath)
    if (!present.ok) return present
    if (!present.value) return err(validationFailed('No uploaded file found at that path', { storage_path: 'UPLOAD_NOT_FOUND' }))

    const created = await this.deps.documents.insert(actor, { docType: input.docType, storagePath: input.storagePath, expiryDate: input.expiryDate })
    if (!created.ok) {
      // Don't strand an object no row points at.
      await this.deps.storage.remove([input.storagePath])
      return created
    }
    return created
  }

  async list(actor: ActorContext): Promise<Result<readonly (OrgDocumentRecord & { url: string | null })[]>> {
    if (!roleHasCapability(actor.role, 'org_documents_view')) return err(forbidden('This role cannot view company documents', { role: actor.role }))

    const rows = await this.deps.documents.list(actor)
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

export { ORG_DOC_TYPES }
