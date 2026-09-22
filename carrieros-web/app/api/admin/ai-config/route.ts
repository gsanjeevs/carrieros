// app/api/admin/ai-config/route.ts
// ShipmentX admin console — LLM Provider config (decisions.md T17). GET returns the current
// ai_provider_config row; PUT updates it. Gated on the new admin_ai_config capability, sx_owner
// only (migration 0031) — NOT sx_finance/sx_support, since this also decides which outside vendor
// sees ticket/load content, a materially different decision than a billing override.
//
// Same convention every other /api/admin/** route uses (see app/api/admin/flags/route.ts): the
// capability check inside requireAdminRole() IS the enforcement — ai_provider_config itself has no
// authenticated/anon grant at all, so only the service-role admin client returned here can reach it.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

const VALID_PROVIDERS = ['anthropic', 'openai', 'openai_compatible'] as const
type Provider = (typeof VALID_PROVIDERS)[number]

function isValidProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (VALID_PROVIDERS as readonly string[]).includes(value)
}

export async function GET(request: NextRequest) {
  const ctx = await requireAdminRole(request, 'admin_ai_config')
  if (isErrorResponse(ctx)) return ctx
  const { admin } = ctx

  const { data, error } = await admin
    .from('ai_provider_config')
    .select('provider, model, compatible_base_url, updated_at, updated_by')
    .eq('id', 1)
    .single()

  if (error || !data) {
    logError({ route: 'admin/ai-config GET', requestId: request.headers.get('x-request-id') }, error)
    return apiError('SERVER_ERROR', error?.message ?? 'Failed to load AI provider config', 500)
  }

  return NextResponse.json({ config: data })
}

export async function PUT(request: NextRequest) {
  const ctx = await requireAdminRole(request, 'admin_ai_config')
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

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

  const { data, error } = await admin
    .from('ai_provider_config')
    .update({
      provider,
      model: model.trim(),
      // Only openai_compatible actually uses a base URL -- clearing it for the other two provider
      // types keeps a stale value from lingering after a provider switch.
      compatible_base_url: provider === 'openai_compatible' ? compatibleBaseUrl.trim() : null,
      updated_by: userId,
    })
    .eq('id', 1)
    .select('provider, model, compatible_base_url, updated_at, updated_by')
    .single()

  if (error || !data) {
    logError({ route: 'admin/ai-config PUT', requestId: request.headers.get('x-request-id'), userId }, error)
    return apiError('SERVER_ERROR', error?.message ?? 'Failed to update AI provider config', 500)
  }

  return NextResponse.json({ config: data })
}
