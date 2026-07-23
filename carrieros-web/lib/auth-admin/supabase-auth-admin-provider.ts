// lib/auth-admin/supabase-auth-admin-provider.ts
// Today's only AuthAdminProvider implementation. Wraps a service-role
// SupabaseClient (from createAdminClient()) — same privilege level as the
// direct `admin.auth.admin.*` calls it replaces.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthAdminProvider, AuthAdminError, AuthAdminUser } from './types'

function toAuthAdminError(error: { message: string; status?: number } | null): AuthAdminError | null {
  if (!error) return null
  return { message: error.message, status: error.status }
}

export class SupabaseAuthAdminProvider implements AuthAdminProvider {
  constructor(private readonly admin: SupabaseClient) {}

  async listUsers(opts?: { page?: number; perPage?: number }) {
    const { data, error } = await this.admin.auth.admin.listUsers(opts)
    if (error || !data) return { data: null, error: toAuthAdminError(error) ?? { message: 'listUsers failed' } }
    const users: AuthAdminUser[] = data.users.map((u) => ({
      id: u.id,
      email: u.email ?? null,
      lastSignInAt: u.last_sign_in_at ?? null,
    }))
    return { data: { users }, error: null }
  }

  async getUserById(userId: string) {
    const { data, error } = await this.admin.auth.admin.getUserById(userId)
    if (error) return { data: null, error: toAuthAdminError(error) }
    const user: AuthAdminUser | null = data?.user
      ? { id: data.user.id, email: data.user.email ?? null, lastSignInAt: data.user.last_sign_in_at ?? null }
      : null
    return { data: { user }, error: null }
  }

  async inviteUserByEmail(email: string, opts?: { data?: Record<string, unknown>; redirectTo?: string }) {
    const { data, error } = await this.admin.auth.admin.inviteUserByEmail(email, {
      data: opts?.data,
      redirectTo: opts?.redirectTo,
    })
    if (error || !data?.user) return { data: null, error: toAuthAdminError(error) ?? { message: 'inviteUserByEmail failed' } }
    const user: AuthAdminUser = { id: data.user.id, email: data.user.email ?? null, lastSignInAt: data.user.last_sign_in_at ?? null }
    return { data: { user }, error: null }
  }

  async deleteUser(userId: string) {
    const { error } = await this.admin.auth.admin.deleteUser(userId)
    return { error: toAuthAdminError(error) }
  }

  async generateMagicLink(email: string, opts?: { redirectTo?: string }) {
    const { data, error } = await this.admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: opts?.redirectTo ? { redirectTo: opts.redirectTo } : undefined,
    })
    if (error || !data) return { data: null, error: toAuthAdminError(error) ?? { message: 'generateLink failed' } }
    return { data: { actionLink: data.properties.action_link }, error: null }
  }
}
