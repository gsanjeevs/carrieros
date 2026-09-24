// POST /api/v1/driver-messages/{id}/translate — real LLM-backed translation,
// replacing the legacy stub route (app/api/driver-messages/[id]/translate)
// which never called any backend. Cached per (message, target_language), so
// naturally idempotent — no Idempotency-Key required.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createDriverMessageService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { LoadIdParamsSchema, TranslateMessageBodySchema, TranslateMessageResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = LoadIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid id', 400)

  let json: unknown
  try { json = await request.json() }
  catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = TranslateMessageBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createDriverMessageService(authed.supabase).translate(actor.value, params.data.id, body.data.target_language)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(TranslateMessageResponseSchema.parse({ translated_body: result.value }))
}
