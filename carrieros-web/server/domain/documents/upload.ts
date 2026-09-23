// server/domain/documents/upload.ts
// Rules for files attached to a load. Pure. The PATH is the security-relevant part:
// it is built here, on the server, from verified ids -- never taken from the client --
// and finalize re-checks that a claimed path matches the pattern for THIS org and
// load, so a client cannot attach someone else's object to its own load.
export const DOCUMENT_TYPES = ['pod'] as const // extend as further types move onto this path
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

// Mirrors the bucket's own allowlist (storage.buckets.allowed_mime_types); storage remains the enforcement point.
export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'] as const
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number]

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // mirrors the bucket's file_size_limit

const EXTENSION: Record<UploadContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

export function buildStoragePath(orgId: number, loadId: number, type: DocumentType, uuid: string, contentType: UploadContentType): string {
  return `${orgId}/loads/${loadId}/${type}-${uuid}.${EXTENSION[contentType]}`
}

/** True only for a path this system would have issued for exactly this org, load and type. */
export function isIssuedPath(path: string, orgId: number, loadId: number, type: DocumentType): boolean {
  const extensions = Object.values(EXTENSION).join('|')
  return new RegExp(`^${orgId}/loads/${loadId}/${type}-[0-9a-f-]{36}\\.(${extensions})$`).test(path)
}
