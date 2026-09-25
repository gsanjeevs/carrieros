// GET /api/v1/admin/error-log — ShipmentX platform-admin Debug/Error Log
// viewer (migration 0038). Transport only: authenticate as ShipmentX staff
// (same requireAdminRole() gate every /api/admin/** route uses, per
// lib/admin-auth.ts), validate the query against the contract, delegate to
// ErrorLogQueryService, map the result. Best-effort mirror of
// lib/observability.ts logError() calls — full stack traces live in Sentry
// only, never here.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, isErrorResponse } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'
import { createErrorLogQueryService } from '@/server/composition'
import { domainErrorResponse } from '@/server/http-errors'
import { ListErrorLogQuerySchema, ListErrorLogResponseSchema } from '@/server/contract/schemas'

const DEFAULT_LIMIT = 50

export async function GET(request: NextRequest) {
  const ctx = await requireAdminRole(request)
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const params = request.nextUrl.searchParams
  const parsed = ListErrorLogQuerySchema.safeParse({
    route_contains: params.get('route_contains') ?? undefined,
    org_id: params.has('org_id') ? params.get('org_id') : undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    limit: params.has('limit') ? params.get('limit') : undefined,
    offset: params.has('offset') ? params.get('offset') : undefined,
  })
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid query', 400)

  const limit = parsed.data.limit ?? DEFAULT_LIMIT
  const offset = parsed.data.offset ?? 0
  const requestId = request.headers.get('x-request-id')

  const result = await createErrorLogQueryService(admin).list({
    routeContains: parsed.data.route_contains,
    orgId: parsed.data.org_id,
    from: parsed.data.from,
    to: parsed.data.to,
    limit,
    offset,
  })
  if (!result.ok) {
    logError({ route: 'api/v1/admin/error-log GET', requestId }, result.error.detail)
    return domainErrorResponse(result.error)
  }

  const body = ListErrorLogResponseSchema.parse({
    entries: result.value.rows.map((r) => ({
      id: r.id,
      route: r.route,
      message: r.message,
      level: r.level,
      org_id: r.orgId,
      org_name: r.orgName,
      user_id: r.userId,
      request_id: r.requestId,
      context: r.context,
      created_at: r.createdAt,
    })),
    total: result.value.total,
    limit,
    offset,
  })
  return NextResponse.json(body)
}
