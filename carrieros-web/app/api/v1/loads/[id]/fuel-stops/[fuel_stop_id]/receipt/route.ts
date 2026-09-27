// POST /api/v1/loads/{id}/fuel-stops/{fuel_stop_id}/receipt — step 3 of a fuel
// receipt upload (mockup-18's missing piece). Step 1 (signed upload slot) reuses
// the existing generic POST /loads/{id}/document-uploads (type 'fuel_receipt') —
// see server/contract/schemas.ts's AttachFuelStopReceiptBodySchema comment for
// why a second signing endpoint isn't needed. This step verifies the uploaded
// object really exists at the issued path, then attaches it to the fuel stop's
// own receipt_path column (naturally idempotent — attaching the same path twice
// is a no-op UPDATE, no Idempotency-Key ceremony needed).
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createDriverActionService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { AttachFuelStopReceiptBodySchema, AttachFuelStopReceiptResponseSchema, FuelStopReceiptParamsSchema } from '@/server/contract/schemas'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; fuel_stop_id: string }> }) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  const rawParams = await context.params
  const params = FuelStopReceiptParamsSchema.safeParse({ id: Number(rawParams.id), fuel_stop_id: rawParams.fuel_stop_id })
  if (!params.success) return apiError('VALIDATION_ERROR', 'Invalid id', 400)

  let json: unknown
  try { json = await request.json() }
  catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = AttachFuelStopReceiptBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid body', 400)

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createDriverActionService(authed.supabase).attachFuelStopReceipt(
    actor.value,
    params.data.id,
    params.data.fuel_stop_id,
    body.data.storage_path
  )
  if (!result.ok) return domainErrorResponse(result.error)
  if (!result.value) return apiError('NOT_FOUND', 'Fuel stop not found', 404)

  return NextResponse.json(AttachFuelStopReceiptResponseSchema.parse({ id: params.data.fuel_stop_id, receipt_attached: true }))
}
