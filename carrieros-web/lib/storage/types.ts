// lib/storage/types.ts
// Provider-agnostic seam for object storage (Supabase Storage today; S3/GCS/
// Azure Blob later if we ever deploy to another hyperscaler — see
// docs/architecture-principles.md Rule G). Call sites depend on this
// interface, never on `supabase.storage.*` directly, so a provider swap only
// touches the implementation file, not every component that uploads/reads/
// deletes a document.
//
// Deliberately just 3 methods — the ones actually used today (see Rule B's
// "cover what's reused, not a speculative full API"). `uploadFile` hides
// *how* the upload happens (a single SDK call today; a future S3/GCS/Azure
// implementation would likely do it as a signed-PUT-URL round trip
// internally) behind one call site-facing method, so callers never need to
// change when the mechanism does.
export interface StorageProvider {
  uploadFile(path: string, file: File | Blob, contentType?: string): Promise<void>
  getSignedUrl(path: string, expiresInSeconds: number): Promise<string>
  remove(paths: string[]): Promise<void>
  // Added for send-documents-to-customer (app/api/loads/[id]/send-documents)
  // — the first real need for server-side file bytes, not just a signed
  // URL, since an emailed attachment needs the actual content.
  download(path: string): Promise<Blob>
  /**
   * A one-shot URL a client can PUT raw bytes to, valid for exactly this path.
   * Lets big files (phone photos) go straight to storage instead of through an API
   * body, which serverless hosts cap at a few MB.
   */
  createSignedUploadUrl(path: string): Promise<string>
  exists(path: string): Promise<boolean>
}
