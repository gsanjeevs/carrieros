// POST /api/v1/me/avatar/uploads — request a signed upload URL. The client
// sends bytes directly to storage; the API never receives the image body.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createProfileAvatarService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { RequestAvatarUploadBodySchema, RequestAvatarUploadResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed
  let json: unknown
  try { json = await request.json() } catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = RequestAvatarUploadBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid avatar upload', 400)
  const actor = await buildActorContext(authed.supabase, authed.user, request.headers.get('x-request-id') ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)
  const result = await createProfileAvatarService(authed.supabase).requestUpload(actor.value, {
    contentType: body.data.content_type,
    sizeBytes: body.data.size_bytes,
  })
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(RequestAvatarUploadResponseSchema.parse({
    upload_url: result.value.uploadUrl,
    storage_path: result.value.storagePath,
    content_type: result.value.contentType,
  }))
}
