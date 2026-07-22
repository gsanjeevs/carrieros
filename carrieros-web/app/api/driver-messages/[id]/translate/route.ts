// app/api/driver-messages/[id]/translate/route.ts
// POST — translate a driver_messages row into `target_language`, caching the
// result in driver_message_translations (unique on message_id, target_language)
// so a thread re-opened in the same language never re-translates. Same
// driver_chat gate as app/api/driver-messages/route.ts — translation is part
// of that one gated feature, not a separate entitlement.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { hasFeature } from '@/lib/entitlements'
import { SUPPORTED_LOCALES } from '@/i18n/request'

const DISPATCH_ROLES = ['owner', 'solo', 'dispatcher']

type Ctx = { params: Promise<{ id: string }> }

/**
 * TODO(translate): the real backend is genuinely undecided (an LLM call vs.
 * a dedicated service like DeepL/Google Translate — see decisions.md), so
 * there is nothing to wire up yet. Mirrors lib/stripe.ts's
 * createStripeCustomer() in spirit: no network call is made, and the
 * "translated" output is obviously fake — prefixed so nobody testing this
 * mistakes it for a working translation.
 */
async function translateText(body: string, targetLanguage: string): Promise<string> {
  console.log(
    '[driver-messages:translate-stub] no translation backend configured — returning the original text',
    JSON.stringify({ targetLanguage })
  )
  return `[STUB TRANSLATION → ${targetLanguage}] ${body}`
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const messageId = Number(id)
  if (!Number.isFinite(messageId)) {
    return apiError('VALIDATION_ERROR', 'Invalid message id', 400)
  }

  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) {
    return apiError('NOT_ONBOARDED', 'No organization found for this user', 400)
  }

  const entitled = await hasFeature(supabase, 'driver_chat')
  if (!entitled) {
    return apiError(
      'TIER_UPGRADE_REQUIRED',
      'Driver messaging requires the Growth plan or above',
      403
    )
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400)
  }

  const targetLanguage = body.target_language
  if (
    typeof targetLanguage !== 'string' ||
    !(SUPPORTED_LOCALES as readonly string[]).includes(targetLanguage)
  ) {
    return apiError(
      'VALIDATION_ERROR',
      `target_language must be one of ${SUPPORTED_LOCALES.join(', ')}`,
      400
    )
  }

  const { data: message } = await supabase
    .from('driver_messages')
    .select('id, body, load_id, carrier_org_id')
    .eq('id', messageId)
    .maybeSingle()

  if (!message) {
    return apiError('NOT_FOUND', 'No such message', 404)
  }

  // Same access shape as the send route: owner/solo/dispatcher of the
  // message's org, or the driver assigned to its load. Checked explicitly
  // here rather than relying solely on RLS, matching this codebase's
  // convention (app/api/team/[id]/route.ts).
  let allowed =
    message.carrier_org_id === profile.org_id && DISPATCH_ROLES.includes(profile.role)

  if (!allowed) {
    const { data: driverRow } = await supabase
      .from('drivers')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle()
    if (driverRow) {
      const { data: load } = await supabase
        .from('loads')
        .select('driver_id')
        .eq('id', message.load_id)
        .maybeSingle()
      allowed = !!load && load.driver_id === driverRow.id
    }
  }

  if (!allowed) {
    return apiError('FORBIDDEN', 'You do not have access to this message', 403)
  }

  // Cache check first — the plan calls for never re-translating a message
  // that already has a cached row for this (message_id, target_language)
  // pair (enforced at the DB level too, via a unique constraint).
  const { data: cached } = await supabase
    .from('driver_message_translations')
    .select('translated_body')
    .eq('message_id', messageId)
    .eq('target_language', targetLanguage)
    .maybeSingle()

  if (cached) {
    return NextResponse.json({ translated_body: cached.translated_body })
  }

  const translatedBody = await translateText(message.body, targetLanguage)

  const { data: inserted, error } = await supabase
    .from('driver_message_translations')
    .insert({
      message_id: messageId,
      target_language: targetLanguage,
      translated_body: translatedBody,
    })
    .select('translated_body')
    .single()

  if (error || !inserted) {
    console.error('[api/driver-messages/:id/translate POST]', error)
    return apiError('SERVER_ERROR', error?.message ?? 'Failed to translate message', 500)
  }

  return NextResponse.json({ translated_body: inserted.translated_body })
}
