// server/infrastructure/supabase/object-storage.ts
// ObjectStorage over the existing StorageProvider seam (Rule G), with the CALLER'S
// client so storage.objects RLS (org folder scoping) still applies beneath the
// application-level checks.
import type { StorageProvider } from '@/lib/storage'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ObjectStorage } from '../../ports'

async function guard<T>(what: string, fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn())
  } catch (e) {
    return err(domainError('PRECONDITION_FAILED', `${what} failed: ${e instanceof Error ? e.message : String(e)}`))
  }
}

export class SupabaseObjectStorage implements ObjectStorage {
  constructor(private readonly provider: StorageProvider) {}
  createUploadUrl(path: string) {
    return guard('create upload url', () => this.provider.createSignedUploadUrl(path))
  }
  exists(path: string) {
    return guard('object lookup', () => this.provider.exists(path))
  }
  createDownloadUrl(path: string, ttlSeconds: number) {
    return guard('create download url', () => this.provider.getSignedUrl(path, ttlSeconds))
  }
  remove(paths: readonly string[]) {
    return guard('remove', () => this.provider.remove([...paths]))
  }
}
