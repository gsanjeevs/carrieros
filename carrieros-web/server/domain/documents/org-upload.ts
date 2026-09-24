// server/domain/documents/org-upload.ts
// Rules for company-level compliance documents (COI, MC authority, DOT cert,
// UCR, W-9, business license). Sibling to upload.ts's per-load documents:
// same "server builds and verifies the path" security model, different types
// and path shape (no load id — these are scoped to the org itself). Matches
// the web app's existing `{carrier_org_id}/company/{filename}` convention
// (components/CompanyDocuments.tsx), but with a server-chosen uuid instead of
// a client-chosen filename, consistent with the load-document path's security
// rationale: the path is the security-relevant part, never taken from the client.
export const ORG_DOC_TYPES = [
  'coi', 'general_liability', 'workers_comp', 'mc_authority',
  'dot_certificate', 'ucr', 'w9', 'business_license',
] as const
export type OrgDocType = (typeof ORG_DOC_TYPES)[number]

export const ORG_UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'] as const
export type OrgUploadContentType = (typeof ORG_UPLOAD_CONTENT_TYPES)[number]

export const MAX_ORG_UPLOAD_BYTES = 10 * 1024 * 1024

const EXTENSION: Record<OrgUploadContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

export function buildOrgStoragePath(orgId: number, type: OrgDocType, uuid: string, contentType: OrgUploadContentType): string {
  return `${orgId}/company/${type}-${uuid}.${EXTENSION[contentType]}`
}

/** True only for a path this system would have issued for exactly this org and type. */
export function isIssuedOrgPath(path: string, orgId: number, type: OrgDocType): boolean {
  const extensions = Object.values(EXTENSION).join('|')
  return new RegExp(`^${orgId}/company/${type}-[0-9a-f-]{36}\\.(${extensions})$`).test(path)
}
