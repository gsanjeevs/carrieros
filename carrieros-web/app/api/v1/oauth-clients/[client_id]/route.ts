// DELETE /api/v1/oauth-clients/{client_id} — revoke one public developer API
// client. Session-authenticated (owner/solo human), not the public API's own
// OAuth boundary. Transport only.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { logError } from '@/lib/observability'
import { createOAuthClientService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { notFound } from '@/server/domain/shared/result'
import { OAuthClientIdParamsSchema, RevokeOAuthClientResponseSchema } from '@/server/contract/schemas'

export async function DELETE(request: NextRequest, context: { params: Promise<{ client_id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const params = OAuthClientIdParamsSchema.safeParse({ client_id: (await context.params).client_id })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid client_id', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createOAuthClientService().revoke(actor.value, params.data.client_id)
  if (!result.ok) {
    logError({ route: 'api/v1/oauth-clients/[client_id] DELETE', requestId, userId: authed.user.id }, result.error.detail)
    return domainErrorResponse(result.error)
  }
  if (!result.value) return domainErrorResponse(notFound('OAuth client'))

  return NextResponse.json(RevokeOAuthClientResponseSchema.parse({ ok: true }))
}
