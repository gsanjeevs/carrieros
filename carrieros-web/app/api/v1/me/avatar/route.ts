// POST /api/v1/me/avatar — finalize a signed profile-photo upload.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createProfileAvatarService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { FinalizeAvatarBodySchema, OkResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  let json: unknown
  try { json = await request.json() } catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = FinalizeAvatarBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid avatar', 400)
  const actor = await buildActorContext(authed.supabase, authed.user, request.headers.get('x-request-id') ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)
  const result = await createProfileAvatarService(authed.supabase).finalize(actor.value, body.data.storage_path)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(OkResponseSchema.parse({ ok: true }))
}

export async function DELETE(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed
  const actor = await buildActorContext(authed.supabase, authed.user, request.headers.get('x-request-id') ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)
  const result = await createProfileAvatarService(authed.supabase).delete(actor.value)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(OkResponseSchema.parse({ ok: true }))
}
