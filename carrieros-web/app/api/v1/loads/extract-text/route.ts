// POST /api/v1/loads/extract-text — mirrors app/api/extract-load/route.ts
// exactly (AI paste-text load extraction). Stateless LLM passthrough, same
// as extract-image — calls lib/extract-load.ts's extractLoadFromText()
// directly, no domain/application/infra layer needed. Unlike extract-image,
// the legacy route this mirrors DOES gate on the load_intake_extract
// capability (extraction is a paid LLM call; only roles that create loads
// may spend it) — preserved here to match.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { extractLoadFromText, ExtractionFailedError } from '@/lib/extract-load'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'
import { ExtractLoadImageResponseSchema, ExtractLoadTextBodySchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const { data: profile } = await getProfileForUser(authed.supabase, authed.user.id)
  if (!profile?.org_id || !roleHasCapability(profile.role, 'load_intake_extract')) {
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)
  }

  let json: unknown
  try { json = await request.json() }
  catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = ExtractLoadTextBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  try {
    const extracted = await extractLoadFromText(body.data.text, { route: 'api/v1/loads/extract-text', userId: authed.user.id })
    return NextResponse.json(ExtractLoadImageResponseSchema.parse(extracted))
  } catch (err) {
    if (err instanceof ExtractionFailedError) return apiError('EXTRACTION_FAILED', err.message, err.status ?? 500)
    throw err
  }
}
