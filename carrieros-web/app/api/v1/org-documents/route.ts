// /api/v1/org-documents — company-level compliance documents (COI, MC
// authority, DOT cert, UCR, W-9, business license). Never built before as an
// API (legacy or v1); org_documents table/RLS/storage convention already
// exist for the web app (components/CompanyDocuments.tsx).
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createOrgDocumentService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { FinalizeOrgDocumentBodySchema, ListOrgDocumentsResponseSchema, OrgDocumentResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  let json: unknown
  try { json = await request.json() }
  catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = FinalizeOrgDocumentBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createOrgDocumentService(authed.supabase).finalize(actor.value, {
    docType: body.data.doc_type,
    storagePath: body.data.storage_path,
    expiryDate: body.data.expiry_date ?? null,
  })
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(OrgDocumentResponseSchema.parse({
    id: result.value.id,
    doc_type: result.value.docType,
    storage_path: result.value.storagePath,
    expiry_date: result.value.expiryDate,
  }), { status: 201 })
}

export async function GET(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const actor = await buildActorContext(authed.supabase, authed.user, request.headers.get('x-request-id') ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createOrgDocumentService(authed.supabase).list(actor.value)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(ListOrgDocumentsResponseSchema.parse({
    documents: result.value.map((d) => ({
      id: d.id,
      doc_type: d.docType,
      expiry_date: d.expiryDate,
      created_at: d.createdAt,
      url: d.url,
    })),
  }))
}
