// server/infrastructure/supabase/profile-write-repository.ts
// Updates only the ACTOR'S OWN profiles row: the id comes from actor.userId
// (a verified session), never from a request field, and RLS still applies.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { PreferencesPatch } from '../../domain/profile/preferences'
import type { ProfilePreferencesRecord, ProfileWriteRepository } from '../../ports'

export class SupabaseProfileWriteRepository implements ProfileWriteRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async getPreferences(actor: ActorContext): Promise<Result<ProfilePreferencesRecord>> {
    const { data: profile, error } = await this.supabase
      .from('profiles')
      .select('preferred_language, uom_system, date_format, time_format, theme_preference, org_id')
      .eq('id', actor.userId)
      .single()
    if (error) return err(domainError('PRECONDITION_FAILED', `preferences lookup failed: ${error.message}`))

    // carrier_details_select has no role restriction (see billing-query-repository.ts) — any
    // member of the org may read its uom_system default.
    let orgDefaultUom: 'imperial' | 'metric' = 'imperial'
    if (profile.org_id) {
      const { data: details } = await this.supabase
        .from('carrier_details')
        .select('uom_system')
        .eq('org_id', profile.org_id)
        .maybeSingle()
      if (details?.uom_system) orgDefaultUom = details.uom_system as 'imperial' | 'metric'
    }

    return ok({
      preferred_language: profile.preferred_language,
      uom_system: profile.uom_system as 'imperial' | 'metric' | null,
      date_format: profile.date_format,
      time_format: profile.time_format,
      theme_preference: profile.theme_preference,
      org_default_uom_system: orgDefaultUom,
    })
  }

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
