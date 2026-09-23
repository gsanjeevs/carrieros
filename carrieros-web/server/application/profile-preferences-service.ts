// server/application/profile-preferences-service.ts
// A user changing their own display preferences and device push token. Trivial
// rules, but they are still rules that belong in one place rather than five
// hooks: only your own profile, only values from the closed sets.
import { ok, err, validationFailed, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { PreferencesPatch } from '../domain/profile/preferences'
import type { ProfilePreferencesRecord, ProfileWriteRepository } from '../ports'

export class ProfilePreferencesService {
  constructor(private readonly deps: { readonly profiles: ProfileWriteRepository }) {}

  async getPreferences(actor: ActorContext): Promise<Result<ProfilePreferencesRecord>> {
    return this.deps.profiles.getPreferences(actor)
  }

  async updatePreferences(actor: ActorContext, patch: PreferencesPatch): Promise<Result<void>> {
    if (Object.keys(patch).length === 0) return err(validationFailed('No preferences provided'))
    return this.deps.profiles.updatePreferences(actor, patch)
  }

  async setPushToken(actor: ActorContext, token: string): Promise<Result<void>> {
    const trimmed = token.trim()
    if (!trimmed) return err(validationFailed('Push token is empty', { token: 'REQUIRED' }))
    const result = await this.deps.profiles.setPushToken(actor, trimmed)
    return result.ok ? ok(undefined) : result
  }
}
