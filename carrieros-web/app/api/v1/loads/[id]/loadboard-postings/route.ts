// GET/POST /api/v1/loads/{id}/loadboard-postings — the load-detail "Post to DAT" action (migration
// 0052). GET reports whether this load has already been posted (the load-detail button's "already
// posted" check); POST triggers a new posting via LoadboardPostingService, which re-checks the
// loadboard_posting capability AND Growth+ feature gate, decrypts the org's DAT credential, calls the
// injected DatClient (mocked in Phase 1 -- see server/infrastructure/loadboard/dat-client.ts), and
// records the result in loadboard_postings. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createLoadboardPostingService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import {
  CreateLoadboardPostingBodySchema,
  CreateLoadboardPostingResponseSchema,
  GetLoadboardPostingResponseSchema,
  LoadboardPostingParamsSchema,
} from '@/server/contract/schemas'
import type { LoadboardPostingSummary } from '@/server/domain/loadboard/model'

function toApiShape(p: LoadboardPostingSummary) {
  return {
    load_id: p.loadId,
    provider: p.provider,
    external_posting_id: p.externalPostingId,
    posted_at: p.postedAt,
    posted_by: p.postedBy,
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = LoadboardPostingParamsSchema.safeParse({ id: (await context.params).id })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid load id', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createLoadboardPostingService(authed.supabase).getPostingStatus(actor.value, params.data.id)
  if (!result.ok) return domainErrorResponse(result.error)

  const body = GetLoadboardPostingResponseSchema.parse({ posting: result.value ? toApiShape(result.value) : null })
  return NextResponse.json(body)
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = LoadboardPostingParamsSchema.safeParse({ id: (await context.params).id })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid load id', 400)

  let json: unknown = {}
  try {
    const text = await request.text()
    json = text ? JSON.parse(text) : {}
  } catch {
    return apiError('VALIDATION_ERROR', 'Body must be JSON', 400)
  }
  const parsed = CreateLoadboardPostingBodySchema.safeParse(json)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createLoadboardPostingService(authed.supabase).postLoad(actor.value, params.data.id, parsed.data.provider ?? 'dat')
  if (!result.ok) {
    logError({ route: 'api/v1/loads/[id]/loadboard-postings POST', requestId, userId: authed.user.id }, result.error.detail)
    return domainErrorResponse(result.error)
  }

  const body = CreateLoadboardPostingResponseSchema.parse({ posting: toApiShape(result.value) })
  return NextResponse.json(body)
}
