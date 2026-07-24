// app/api/extract-load-image/route.ts
// Mobile-facing counterpart to app/api/extract-load/route.ts — a driver or
// dispatcher photographs a rate confirmation/BOL instead of pasting text.
// Same auth posture (any authenticated carrier user, no org/role check —
// the caller hasn't created a load yet) and same response shape, so the
// mobile review screen can reuse extract-load's field names.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { extractLoadFromImage, ExtractionFailedError, isSupportedImageMediaType } from '@/lib/extract-load'

const MAX_BASE64_LENGTH = 8 * 1024 * 1024 // ~6MB decoded, generous for a phone photo

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx

  let image_base64: string
  let media_type: string
  try {
    const body = await request.json()
    image_base64 = body.image_base64
    media_type = body.media_type
    if (!image_base64 || typeof image_base64 !== 'string') {
      return apiError('VALIDATION_ERROR', 'image_base64 is required', 400)
    }
    if (image_base64.length > MAX_BASE64_LENGTH) {
      return apiError('VALIDATION_ERROR', 'Image is too large', 400)
    }
    if (!isSupportedImageMediaType(media_type)) {
      return apiError('VALIDATION_ERROR', 'Unsupported media_type', 400)
    }
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400)
  }

  try {
    const extracted = await extractLoadFromImage(image_base64, media_type, { route: 'api/extract-load-image', userId: ctx.user.id })
    return NextResponse.json(extracted)
  } catch (err) {
    if (err instanceof ExtractionFailedError) {
      return apiError('EXTRACTION_FAILED', err.message, err.status ?? 500)
    }
    throw err
  }
}
