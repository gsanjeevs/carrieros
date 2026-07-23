// lib/storage/index.ts
// Single import point for call sites: `import { createStorageProvider } from
// '@/lib/storage'`. Swapping the backing provider later (S3/GCS/Azure Blob)
// means changing the one line inside this factory, not any caller.
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseStorageProvider } from './supabase-storage-provider'
import type { StorageProvider } from './types'

export function createStorageProvider(supabase: SupabaseClient): StorageProvider {
  return new SupabaseStorageProvider(supabase)
}

export type { StorageProvider } from './types'
