// POST /api/v1/loads/extract-image — mirrors app/api/extract-load-image/route.ts
// exactly (AI photo-to-load extraction). Stateless LLM passthrough — no
// load exists yet, no DB read/write — so this calls lib/extract-load.ts's
// extractLoadFromImage() directly, same as the legacy route, rather than
// going through server/application (there is no aggregate to protect here).
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { extractLoadFromImage, ExtractionFailedError } from '@/lib/extract-load'
import { ExtractLoadImageBodySchema, ExtractLoadImageResponseSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  let json: unknown
  try { json = await request.json() }
  catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = ExtractLoadImageBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  try {
    const extracted = await extractLoadFromImage(body.data.image_base64, body.data.media_type, {
      route: 'api/v1/loads/extract-image',
      userId: authed.user.id,
    })
    return NextResponse.json(ExtractLoadImageResponseSchema.parse(extracted))
  } catch (err) {
    if (err instanceof ExtractionFailedError) return apiError('EXTRACTION_FAILED', err.message, err.status ?? 500)
    throw err
  }
}
