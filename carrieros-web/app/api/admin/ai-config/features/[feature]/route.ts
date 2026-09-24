// app/api/admin/ai-config/features/[feature]/route.ts
// Per-feature LLM override on top of ai_provider_config's platform-wide
// default (migration 0036, decisions.md T17). Lets one feature (starting
// with 'translation') run on a different/cheaper — including self-hosted
// open-weight — model without touching every other AI feature's config.
// Same admin_ai_config capability, sx_owner only, and same never-decrypt
// posture as app/api/admin/ai-config/route.ts (shares its key-handling logic
// via lib/ai/admin-config-shared.ts).
//
// GET returns the override if one exists, or { override: null } meaning
// "this feature currently uses the platform-wide default." PUT creates or
// replaces the override row entirely (never a partial merge — same
// self-contained-row semantics ai_feature_overrides itself has). DELETE
// removes the row, reverting the feature to the platform-wide default.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'
import { AI_FEATURES, type AiFeature } from '@/lib/ai'
import { applyKeyFields, isValidProvider, maskedPreview, VALID_PROVIDERS } from '@/lib/ai/admin-config-shared'
import type { Database } from '@/types/supabase'

type OverrideInsert = Database['public']['Tables']['ai_feature_overrides']['Insert']

const OVERRIDE_SELECT =
  'feature, provider, model, compatible_base_url, updated_at, updated_by, anthropic_api_key_preview, openai_api_key_preview, openai_compatible_api_key_preview'

interface OverrideRow {
  feature: string
  provider: string
  model: string
  compatible_base_url: string | null
  updated_at: string
  updated_by: string | null
  anthropic_api_key_preview: string | null
  openai_api_key_preview: string | null
  openai_compatible_api_key_preview: string | null
}

function toResponseOverride(data: OverrideRow) {
  return {
    feature: data.feature,
    provider: data.provider,
    model: data.model,
    compatible_base_url: data.compatible_base_url,
    updated_at: data.updated_at,
    updated_by: data.updated_by,
    anthropic_key_configured: data.anthropic_api_key_preview !== null,
    anthropic_key_preview: maskedPreview(data.anthropic_api_key_preview),
    openai_key_configured: data.openai_api_key_preview !== null,
    openai_key_preview: maskedPreview(data.openai_api_key_preview),
    openai_compatible_key_configured: data.openai_compatible_api_key_preview !== null,
    openai_compatible_key_preview: maskedPreview(data.openai_compatible_api_key_preview),
  }
}

function parseFeature(raw: string): AiFeature | null {
  return (AI_FEATURES as readonly string[]).includes(raw) ? (raw as AiFeature) : null
}

export async function GET(request: NextRequest, context: { params: Promise<{ feature: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_ai_config')
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const feature = parseFeature((await context.params).feature)
  if (!feature) return apiError('VALIDATION_ERROR', `feature must be one of: ${AI_FEATURES.join(', ')}`, 400)

  const { data, error } = await admin.from('ai_feature_overrides').select(OVERRIDE_SELECT).eq('feature', feature).maybeSingle()
  if (error) {
    logError({ route: 'admin/ai-config/features/[feature] GET', requestId: request.headers.get('x-request-id') }, error)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  return NextResponse.json({ override: data ? toResponseOverride(data) : null })
}

export async function PUT(request: NextRequest, context: { params: Promise<{ feature: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_ai_config')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const feature = parseFeature((await context.params).feature)
  if (!feature) return apiError('VALIDATION_ERROR', `feature must be one of: ${AI_FEATURES.join(', ')}`, 400)

  const body = await request.json()
  const provider = body?.provider
  const model = body?.model
  const compatibleBaseUrl = body?.compatible_base_url

  if (!isValidProvider(provider))
    return apiError('VALIDATION_ERROR', `provider must be one of: ${VALID_PROVIDERS.join(', ')}`, 400)
  if (typeof model !== 'string' || !model.trim())
    return apiError('VALIDATION_ERROR', 'model is required', 400)
  if (provider === 'openai_compatible' && (typeof compatibleBaseUrl !== 'string' || !compatibleBaseUrl.trim()))
    return apiError('VALIDATION_ERROR', 'compatible_base_url is required when provider is openai_compatible', 400)

  const row: OverrideInsert = {
    feature,
    provider,
    model: model.trim(),
    compatible_base_url: provider === 'openai_compatible' ? compatibleBaseUrl.trim() : null,
    updated_by: userId,
  }

  const keyError = applyKeyFields(row, body, { route: 'admin/ai-config/features/[feature] PUT', requestId: request.headers.get('x-request-id'), userId })
  if (keyError) return keyError

  // Full replace, upserted on the feature primary key — an override is a
  // self-contained row, never a partial merge with a prior one.
  const { data, error } = await admin.from('ai_feature_overrides').upsert(row).select(OVERRIDE_SELECT).single()
  if (error || !data) {
    logError({ route: 'admin/ai-config/features/[feature] PUT', requestId: request.headers.get('x-request-id'), userId }, error)
    return apiError('SERVER_ERROR', error?.message ?? 'Failed to save feature override', 500)
  }

  return NextResponse.json({ override: toResponseOverride(data) })
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ feature: string }> }) {
  const ctx = await requireAdminRole(request, 'admin_ai_config')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const feature = parseFeature((await context.params).feature)
  if (!feature) return apiError('VALIDATION_ERROR', `feature must be one of: ${AI_FEATURES.join(', ')}`, 400)

  const { error } = await admin.from('ai_feature_overrides').delete().eq('feature', feature)
  if (error) {
    logError({ route: 'admin/ai-config/features/[feature] DELETE', requestId: request.headers.get('x-request-id'), userId }, error)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  return NextResponse.json({ ok: true })
}
