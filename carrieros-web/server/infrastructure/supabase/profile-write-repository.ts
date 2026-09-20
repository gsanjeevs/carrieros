// server/infrastructure/supabase/profile-write-repository.ts
// Updates only the ACTOR'S OWN profiles row: the id comes from actor.userId
// (a verified session), never from a request field, and RLS still applies.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { PreferencesPatch } from '../../domain/profile/preferences'
import type { ProfileWriteRepository } from '../../ports'

export class SupabaseProfileWriteRepository implements ProfileWriteRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async updatePreferences(actor: ActorContext, patch: PreferencesPatch): Promise<Result<void>> {
    const { error } = await this.supabase.from('profiles').update({ ...patch }).eq('id', actor.userId)
    if (error) return err(domainError('PRECONDITION_FAILED', `preferences update failed: ${error.message}`))
    return ok(undefined)
  }

  async setPushToken(actor: ActorContext, token: string): Promise<Result<void>> {
    const { error } = await this.supabase.from('profiles').update({ push_token: token }).eq('id', actor.userId)
    if (error) return err(domainError('PRECONDITION_FAILED', `push token update failed: ${error.message}`))
    return ok(undefined)
  }
}
