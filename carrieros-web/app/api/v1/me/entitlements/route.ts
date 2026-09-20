// GET /api/v1/me/entitlements — feature keys the caller's org currently has.
// Transport only, backed by get_my_entitlements() (the audited, RLS-safe
// SECURITY DEFINER function — see supabase/schema/schema.sql SECTION 21):
// same source of truth carrieros-web's own lib/entitlements.ts reads directly
// via .rpc(), just reached over HTTP here so mobile need not call it directly.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createFeatureGate } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { EntitlementsResponseSchema } from '@/server/contract/schemas'

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createFeatureGate(authed.supabase).list(actor.value)
  if (!result.ok) {
    logError({ route: 'api/v1/me/entitlements GET', requestId, userId: authed.user.id }, result.error.detail)
    return domainErrorResponse(result.error)
  }

  return NextResponse.json(EntitlementsResponseSchema.parse({ keys: result.value }))
}
