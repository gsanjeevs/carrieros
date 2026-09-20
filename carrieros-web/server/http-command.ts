// server/http-command.ts
// Transport helper for POST/PATCH /api/v1/<resource>/{id}/<command> routes: authenticate,
// build the actor from the session, and validate the path id, Idempotency-Key header
// and JSON body against the contract. Returns either everything the route needs or the
// error response to send. Keeps each command route down to "call the service, map the
// result", which is what the v1 delegation rule asks of transport.
import { NextRequest, NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import type { ActorContext } from './domain/shared/identity'
import { buildActorContext } from './infrastructure/supabase/actor-context'
import { domainErrorResponse } from './http-errors'
import { IdempotencyKeyHeaderSchema, LoadIdParamsSchema } from './contract/schemas'

export interface ResourceCommand<B> {
  supabase: SupabaseClient<Database>
  userId: string
  actor: ActorContext
  /** The path id of the resource the command targets (a load id or an invoice id, per route). */
  id: number
  idempotencyKey: string
  body: B
  requestId: string | null
}

export async function parseCommand<B>(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
  bodySchema: ZodType<B>,
  options: { requireIdempotencyKey?: boolean; bodyOptional?: boolean } = {}
): Promise<ResourceCommand<B> | NextResponse> {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = LoadIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid id', 400)

  const requireKey = options.requireIdempotencyKey ?? true
  const header = IdempotencyKeyHeaderSchema.safeParse({ 'Idempotency-Key': request.headers.get('idempotency-key') ?? '' })
  if (requireKey && !header.success) return apiError('VALIDATION_ERROR', 'Idempotency-Key header is required (8-128 characters)', 400)

  let json: unknown
  try {
    json = await request.json()
  } catch {
    if (!options.bodyOptional) return apiError('VALIDATION_ERROR', 'Body must be JSON', 400)
    json = {} // a command with no payload (e.g. mark-paid) may send no body at all
  }
  const body = bodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  return {
    supabase: authed.supabase,
    userId: authed.user.id,
    actor: actor.value,
    id: params.data.id,
    idempotencyKey: header.success ? header.data['Idempotency-Key'] : '',
    body: body.data,
    requestId,
  }
}
