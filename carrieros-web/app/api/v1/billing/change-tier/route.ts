// POST /api/v1/billing/change-tier — mirrors app/api/billing/change-tier/route.ts
// (demo mode: writes carrier_details.tier directly, validated against the
// real tiers table). Naturally idempotent (sets an absolute value), so no
// Idempotency-Key is required, same as updateDraftInvoice/assignLoad-style
// state-setting endpoints.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createSetupWriteService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { ChangeTierBodySchema, ChangeTierResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  let json: unknown
  try { json = await request.json() }
  catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = ChangeTierBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createSetupWriteService(authed.supabase).changeTier(actor.value, body.data.tier)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(ChangeTierResponseSchema.parse({ tier: result.value }))
}
