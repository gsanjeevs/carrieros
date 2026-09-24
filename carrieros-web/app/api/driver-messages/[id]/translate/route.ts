// app/api/driver-messages/[id]/translate/route.ts
// POST — translate a driver_messages row into `target_language`. Legacy
// mobile-facing counterpart to app/api/v1/driver-messages/[id]/translate;
// both now share the exact same real (LLM-backed) implementation via
// DriverMessageService.translate() rather than each having its own logic —
// same reasoning as lib/invoice-actions.ts's sendInvoiceAndMarkSent(), one
// shared implementation instead of two. This used to be a stub (no
// translation backend was configured); it now delegates to the real one
// built this session, so the existing "Translate" buttons in
// components/DriverMessageThread.tsx (web) and
// src/components/driver-chat-section.tsx (mobile) — both of which already
// call this exact route — start returning real translations with no UI
// change needed.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { SUPPORTED_LOCALES } from '@/i18n/request'
import { createDriverMessageService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { domainErrorResponse } from '@/server/http-errors'
import { TranslateMessageResponseSchema } from '@/server/contract/schemas'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const messageId = Number(id)
  if (!Number.isFinite(messageId)) return apiError('VALIDATION_ERROR', 'Invalid message id', 400)

  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return apiError('VALIDATION_ERROR', 'Invalid request body', 400) }

  const targetLanguage = body.target_language
  if (typeof targetLanguage !== 'string' || !(SUPPORTED_LOCALES as readonly string[]).includes(targetLanguage)) {
    return apiError('VALIDATION_ERROR', `target_language must be one of ${SUPPORTED_LOCALES.join(', ')}`, 400)
  }

  const requestId = request.headers.get('x-request-id')
  const actor = await buildActorContext(authed.supabase, authed.user, requestId ?? crypto.randomUUID())
  if (!actor.ok) return domainErrorResponse(actor.error)

  const result = await createDriverMessageService(authed.supabase).translate(actor.value, messageId, targetLanguage)
  if (!result.ok) return domainErrorResponse(result.error)
  return NextResponse.json(TranslateMessageResponseSchema.parse({ translated_body: result.value }))
}
