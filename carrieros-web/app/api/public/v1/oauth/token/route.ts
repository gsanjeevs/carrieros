// POST /api/public/v1/oauth/token — OAuth 2.0 client-credentials grant.
// External callers authenticate as an ORGANIZATION here, via a client_id/
// client_secret pair created on the Settings > Developer API page — never
// as a logged-in human. Transport only: validate the body against the
// contract, delegate to PublicApiTokenService, sign the JWT this route (not
// the application service) owns, map the result to an RFC 6749-flavored
// error envelope shared by every /api/public/v1 route.
import { NextRequest, NextResponse } from 'next/server'
import { createPublicApiTokenService } from '@/server/composition'
import { domainErrorToPublicApiResponse, publicApiError, signPublicApiToken, PUBLIC_API_TOKEN_TTL_SECONDS } from '@/lib/public-api-auth'
import { TokenRequestBodySchema, TokenResponseSchema } from '@/server/contract/public-schemas'
import { logError } from '@/lib/observability'

export async function POST(request: NextRequest) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return publicApiError('invalid_request', 'Body must be JSON', 400)
  }

  const parsed = TokenRequestBodySchema.safeParse(json)
  if (!parsed.success) {
    return publicApiError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid request body', 400)
  }

  const result = await createPublicApiTokenService().issueToken({
    clientId: parsed.data.client_id,
    clientSecret: parsed.data.client_secret,
  })
  if (!result.ok) {
    if (result.error.code === 'PRECONDITION_FAILED') {
      logError({ route: 'api/public/v1/oauth/token POST', requestId: request.headers.get('x-request-id') }, result.error.detail)
    }
    return domainErrorToPublicApiResponse(result.error)
  }

  // Signing (not the application service) is the one place the raw JWT secret is touched, matching
  // lib/api-auth.ts owning session-token concerns rather than server/application.
  let accessToken: string
  try {
    accessToken = signPublicApiToken(result.value)
  } catch {
    logError({ route: 'api/public/v1/oauth/token POST', requestId: request.headers.get('x-request-id') }, 'PUBLIC_API_JWT_SECRET is not configured')
    return publicApiError('server_error', 'Public API is not configured', 500)
  }

  const body = TokenResponseSchema.parse({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: PUBLIC_API_TOKEN_TTL_SECONDS,
  })
  return NextResponse.json(body)
}
