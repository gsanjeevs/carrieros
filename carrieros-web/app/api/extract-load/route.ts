// app/api/extract-load/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { extractLoadFromText, ExtractionFailedError } from '@/lib/extract-load'

export async function POST(request: NextRequest) {
  // Any authenticated carrier user (web or mobile) may extract a load —
  // this just needs *a* valid session, not org/role checks, since the
  // caller hasn't created a load yet at this point.
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx

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
