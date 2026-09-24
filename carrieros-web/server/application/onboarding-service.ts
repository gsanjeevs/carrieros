import { buildOnboardingDraft, type OnboardingDraftInput } from '../domain/onboarding/draft'
import { domainError, err, type Result } from '../domain/shared/result'
import type { UserId } from '../domain/shared/identity'
import type { OnboardingRepository } from '../ports'

export class OnboardingService {
  constructor(private readonly deps: { readonly onboarding: OnboardingRepository }) {}

  async onboard(userId: UserId, input: OnboardingDraftInput): Promise<Result<{ org_id: number; load_email: string | null }>> {
    const existing = await this.deps.onboarding.hasOrganization(userId)
    if (!existing.ok) return existing
    if (existing.value) return err(domainError('ALREADY_ONBOARDED', 'Already onboarded'))

    const draft = buildOnboardingDraft(input)
    if (!draft.ok) return draft
    const created = await this.deps.onboarding.create(userId, draft.value)
    if (!created.ok) return created
    return { ok: true, value: { org_id: created.value.orgId, load_email: created.value.loadEmail } }
  }
}
