// app/api/extract-load/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { extractLoadFromText, ExtractionFailedError } from '@/lib/extract-load'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

export async function POST(request: NextRequest) {
  // Extraction is a paid LLM call made on behalf of load intake, so only the roles that create loads may spend it
  // (a driver or finance login used to be able to burn it freely).
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { data: profile } = await getProfileForUser(ctx.supabase, ctx.user.id)
  if (!profile?.org_id || !roleHasCapability(profile.role, 'load_intake_extract'))
    return apiError('FORBIDDEN', 'Insufficient permissions', 403)

  let text: string
  try {
    const body = await request.json()
    text = body.text
    if (!text || typeof text !== 'string' || text.trim().length < 10) {
      return apiError('VALIDATION_ERROR', 'Text is required', 400)
    }
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400)
  }

  try {
    const extracted = await extractLoadFromText(text, { route: 'api/extract-load', userId: ctx.user.id })
    return NextResponse.json(extracted)
  } catch (err) {
    if (err instanceof ExtractionFailedError) {
      return apiError('EXTRACTION_FAILED', err.message, err.status ?? 500)
    }
    throw err
  }
}
