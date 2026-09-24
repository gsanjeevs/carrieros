import { NextRequest, NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { buildActorContext } from './infrastructure/supabase/actor-context'
import { domainErrorResponse } from './http-errors'
import { IdempotencyKeyHeaderSchema } from './contract/schemas'

export async function parseResourceRequest<B>(request: NextRequest, bodySchema?: ZodType<B>) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed
  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const header = IdempotencyKeyHeaderSchema.safeParse({ 'Idempotency-Key': request.headers.get('idempotency-key') ?? '' })
  if (!header.success) return apiError('VALIDATION_ERROR', 'Idempotency-Key header is required (8-128 characters)', 400)

  let body: B | undefined
  if (bodySchema) {
    let json: unknown
    try { json = await request.json() }
    catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid body', 400)
    body = parsed.data
  }
  return { ...authed, actor: actor.value, idempotencyKey: header.data['Idempotency-Key'], body, requestId }
}

export function isHttpResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse
}
