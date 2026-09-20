// lib/storage/supabase-storage-provider.ts
// Today's only StorageProvider implementation. Wraps whatever
// SupabaseClient it's constructed with — a browser (anon-key) client for
// client components (upload/delete are RLS-gated the same way they always
// were) or a server client for Server Components/API routes. Swapping
// clouds later means adding a sibling file (e.g. s3-storage-provider.ts),
// not touching any call site.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { StorageProvider } from './types'

const DOCUMENTS_BUCKET = 'documents'

export class SupabaseStorageProvider implements StorageProvider {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly bucket: string = DOCUMENTS_BUCKET
  ) {}

  async uploadFile(path: string, file: File | Blob, contentType?: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(path, file, { contentType: contentType || undefined, upsert: false })
    if (error) throw error
  }

  async getSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresInSeconds)
    if (error || !data) throw error ?? new Error('createSignedUrl returned no data')
    return data.signedUrl
  }

  async remove(paths: string[]): Promise<void> {
    const { error } = await this.supabase.storage.from(this.bucket).remove(paths)
    if (error) throw error
  }

  async download(path: string): Promise<Blob> {
    const { data, error } = await this.supabase.storage.from(this.bucket).download(path)
    if (error || !data) throw error ?? new Error('download returned no data')
    return data
  }

  async createSignedUploadUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.storage.from(this.bucket).createSignedUploadUrl(path)
    if (error || !data) throw error ?? new Error('createSignedUploadUrl returned no data')
    return data.signedUrl
  }

  async exists(path: string): Promise<boolean> {
    // A folder listing filtered by filename, not storage.exists(): for a missing object under
    // a caller's RLS, exists() surfaces "Bad Request" as an error instead of returning false.
    const slash = path.lastIndexOf('/')
    const dir = slash === -1 ? '' : path.slice(0, slash)
    const name = slash === -1 ? path : path.slice(slash + 1)
    const { data, error } = await this.supabase.storage.from(this.bucket).list(dir, { search: name, limit: 5 })
    if (error) throw error
    return (data ?? []).some((entry) => entry.name === name)
  }
}
