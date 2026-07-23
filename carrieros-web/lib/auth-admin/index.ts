// lib/auth-admin/index.ts
// Single import point: `import { createAuthAdminProvider } from
// '@/lib/auth-admin'`. Swapping the backing provider later (Cognito, etc.)
// means changing the one line inside this factory.
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseAuthAdminProvider } from './supabase-auth-admin-provider'
import type { AuthAdminProvider } from './types'

export function createAuthAdminProvider(admin: SupabaseClient): AuthAdminProvider {
  return new SupabaseAuthAdminProvider(admin)
}

export type { AuthAdminProvider, AuthAdminUser, AuthAdminError } from './types'
