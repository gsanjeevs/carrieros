// lib/public-api-auth.ts
// Auth resolution for /api/public/v1/** — the public developer API's own
// trust boundary. Deliberately NOT lib/api-auth.ts and NOT a wrapper around
// getAuthedContext(): that function assumes a Supabase session/Bearer user
// token, which does not exist here. External callers authenticate as an
// ORGANIZATION via an OAuth 2.0 client-credentials grant (see
// server/application/public-api-token-service.ts for the credential check),
// and this file owns the resulting JWT's signing/verification plus the error
// shape every /api/public/v1 route returns.
//
// Why a signed JWT at all, rather than checking the DB on every call: the
// client_credentials grant's whole point is a short-lived, statelessly
// verifiable token the caller re-presents on each request without hitting
// /oauth/token again. Tier is re-verified at issuance (PublicApiTokenService)
// but deliberately NOT re-checked again for the token's remaining life: a
// token stays valid until it expires (1h) even if the org downgrades a
// minute after issuance. That is an accepted v1 scope decision, not an
// oversight — it matches the token's own stated lifetime, and per-request DB
// entitlement checks would defeat the point of using a bearer token at all.
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'
import { asCorrelationId, asOrgId, asUserId, type ActorContext, type OrgId } from '@/server/domain/shared/identity'
import type { DomainError } from '@/server/domain/shared/result'

export interface PublicApiTokenClaims {
  readonly orgId: OrgId
  readonly clientId: string
  readonly scope: 'read'
}

const JWT_ALGORITHM = 'HS256' as const
const TOKEN_TTL_SECONDS = 3600

function requireSigningSecret(): string | null {
  // Same "refuse rather than run unprotected" posture as CRON_SECRET
  // (app/api/cron/send-reminders/route.ts) — no default, no fallback.
  return process.env.PUBLIC_API_JWT_SECRET || null
}

/** Throws if PUBLIC_API_JWT_SECRET is unset — callers must check requireSigningSecret()/handle 500 first. */
export function signPublicApiToken(claims: { orgId: OrgId; clientId: string; scope: 'read' }): string {
  const secret = requireSigningSecret()
  if (!secret) throw new Error('PUBLIC_API_JWT_SECRET is not configured')
  return jwt.sign({ org_id: claims.orgId, client_id: claims.clientId, scope: claims.scope }, secret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: TOKEN_TTL_SECONDS,
  })
}

export const PUBLIC_API_TOKEN_TTL_SECONDS = TOKEN_TTL_SECONDS

/**
 * Verifies the bearer JWT's signature and expiry and returns the claims it carries, or a 401
 * NextResponse for anything missing/malformed/expired/tampered/wrong-algorithm.
 */
export async function getPublicApiContext(request: NextRequest): Promise<PublicApiTokenClaims | NextResponse> {
  const secret = requireSigningSecret()
  if (!secret) {
    return publicApiError('server_error', 'Public API is not configured', 500)
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return publicApiError('invalid_token', 'Missing bearer token', 401)

  try {
    // algorithms is pinned explicitly -- never trust the token's own `alg` header (alg-confusion attacks).
    const decoded = jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] })
    if (typeof decoded === 'string') return publicApiError('invalid_token', 'Malformed token', 401)

    const orgId = decoded.org_id
    const clientId = decoded.client_id
    const scope = decoded.scope
    if (typeof orgId !== 'number' || typeof clientId !== 'string' || scope !== 'read') {
      return publicApiError('invalid_token', 'Malformed token', 401)
    }
    return { orgId: asOrgId(orgId), clientId, scope: 'read' }
  } catch {
    // Expired, bad signature, or otherwise invalid -- jsonwebtoken distinguishes these internally, but the
    // caller gets one answer either way (never reveal WHY a token is rejected to an untrusted bearer).
    return publicApiError('invalid_token', 'Invalid or expired token', 401)
  }
}

/**
 * Builds the ActorContext the existing, already-org-scoped application services (LoadQueryService,
 * InvoiceQueryService) expect, from a verified public API JWT instead of a Supabase session.
 *
 * role: 'finance' is a deliberate reuse, not a placeholder. Of the existing roles, finance is the ONLY
 * one whose role_capabilities are exactly the read/rate-visibility footprint a read-only external
 * integration needs (loads_view, invoice_actions, rate_visibility) with none of owner's administrative
 * capabilities (team_manage, drivers_manage, vehicles_manage, ...) that a public API token has no business
 * holding even latently. 'owner' would also satisfy today's two read services, but would silently grant
 * every future capability check that branches on role alone — least privilege here costs nothing since v1
 * is read-only anyway. isPlatformOperator is always false: this is a tenant-scoped actor, never platform
 * staff, regardless of which org it belongs to.
 *
 * userId is a synthetic, deliberately non-UUID sentinel — nothing in the read paths this actor calls
 * (LoadQueryService/InvoiceQueryService) writes it to a column, but it still shows up in logError() context
 * so a log line naming this "user" is legible as "the public API, via this client" rather than a
 * misleading-looking real account.
 */
export function buildPublicApiActor(claims: PublicApiTokenClaims): ActorContext {
  return {
    userId: asUserId(`public-api:${claims.clientId}`),
    orgId: claims.orgId,
    role: 'finance',
    isPlatformOperator: false,
    correlationId: asCorrelationId(crypto.randomUUID()),
  }
}

// ── Error shape ──────────────────────────────────────────────────────────────
// One shape for the whole /api/public/v1 surface, including /oauth/token — an
// external developer parses one error format, not this app's internal
// {error_code, error} shape on data routes and something else on the token
// endpoint. `error` values loosely follow RFC 6749 §5.2's token-error
// vocabulary since /oauth/token is a real OAuth 2.0 endpoint; the data routes
// reuse the same small vocabulary for consistency across this one surface.

export function publicApiError(
  error: string,
  description: string,
  status: number,
  extraHeaders?: Record<string, string>
): NextResponse {
  const res = NextResponse.json({ error, error_description: description }, { status })
  if (extraHeaders) for (const [key, value] of Object.entries(extraHeaders)) res.headers.set(key, value)
  return res
}

const DOMAIN_ERROR_MAP: Record<string, { error: string; status: number }> = {
  VALIDATION_FAILED: { error: 'invalid_request', status: 400 },
  FORBIDDEN: { error: 'invalid_client', status: 401 },
  ENTITLEMENT_REQUIRED: { error: 'unauthorized_client', status: 403 },
  NOT_FOUND: { error: 'not_found', status: 404 },
  LIMIT_EXCEEDED: { error: 'rate_limited', status: 429 },
}

export function domainErrorToPublicApiResponse(error: DomainError): NextResponse {
  const mapped = DOMAIN_ERROR_MAP[error.code] ?? { error: 'server_error', status: 500 }
  const headers: Record<string, string> | undefined =
    mapped.error === 'rate_limited' && typeof error.meta?.retryAfterSeconds === 'number'
      ? { 'Retry-After': String(error.meta.retryAfterSeconds) }
      : undefined
  return publicApiError(mapped.error, error.detail, mapped.status, headers)
}

/** 429 for a request that never reached a domain-error-producing service (the per-request rate gate). */
export function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  return publicApiError('rate_limited', 'Too many requests', 429, { 'Retry-After': String(retryAfterSeconds) })
}
