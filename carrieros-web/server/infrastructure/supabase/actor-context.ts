// server/infrastructure/supabase/actor-context.ts
// The context factory the ActorContext contract asks for: identity comes from a
// verified Supabase user, tenant and role come from THEIR OWN profile row, and
// nothing is taken from request input.
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { getProfileForUser } from '@/lib/queries/profiles'
import { asCorrelationId, asOrgId, asUserId, isPlatformRole, type ActorContext, type ActorRole } from '../../domain/shared/identity'
import { domainError, err, ok, type Result } from '../../domain/shared/result'

export async function buildActorContext(
  supabase: SupabaseClient<Database>,
  user: User,
  correlationId: string
): Promise<Result<ActorContext>> {
  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id || !profile.role) {
    return err(domainError('FORBIDDEN', 'Caller has no organization membership yet'))
  }
  const role = profile.role as ActorRole
  return ok({
    userId: asUserId(user.id),
    orgId: asOrgId(Number(profile.org_id)),
    role,
    isPlatformOperator: isPlatformRole(role),
    correlationId: asCorrelationId(correlationId),
  })
}
