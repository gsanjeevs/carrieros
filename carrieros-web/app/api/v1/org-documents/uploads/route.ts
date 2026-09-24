// POST /api/v1/org-documents/uploads — step 1 of a company-document upload:
// get a server-chosen path and a signed URL to PUT the bytes to. Never built
// before as an API (legacy or v1) — the web app uploads straight from the
// browser client instead (components/CompanyDocuments.tsx).
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createOrgDocumentService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { RequestOrgUploadBodySchema, RequestOrgUploadResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  let json: unknown
  try { json = await request.json() }
  catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = RequestOrgUploadBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createOrgDocumentService(authed.supabase).requestUpload(actor.value, {
    docType: body.data.doc_type,
    contentType: body.data.content_type,
  })
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(RequestOrgUploadResponseSchema.parse({
    upload_url: result.value.uploadUrl,
    storage_path: result.value.storagePath,
    content_type: result.value.contentType,
  }))
}
