// DELETE /api/v1/org-documents/{id} — removes the storage object first, then
// the row, same order as components/CompanyDocuments.tsx's web delete flow.
// Added after two mobile-screen-building agents independently found the
// mobile company-documents screen calling this endpoint before it existed.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createOrgDocumentService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { LoadIdParamsSchema, OkResponseSchema } from '@/server/contract/schemas'

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = LoadIdParamsSchema.safeParse({ id: Number((await context.params).id) })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid id', 400)

  const actor = await buildActorContext(authed.supabase, authed.user, request.headers.get('x-request-id') ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createOrgDocumentService(authed.supabase).delete(actor.value, params.data.id)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(OkResponseSchema.parse({ ok: true }))
}
