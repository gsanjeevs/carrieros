import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { decryptSecret } from '@/lib/crypto/secrets'
import type { Provider } from '@/app/(admin)/admin/ai-config/shared'

const PROVIDERS = ['anthropic', 'openai', 'openai_compatible'] as const
type Config = {
  compatible_base_url: string | null
  anthropic_api_key_encrypted: string | null
  openai_api_key_encrypted: string | null
  openai_compatible_api_key_encrypted: string | null
}

function modelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return [...new Set(data.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const id = (item as { id?: unknown }).id
    return typeof id === 'string' && id.trim() ? [id.trim()] : []
  }))].sort((a, b) => a.localeCompare(b))
}

function isTextGenerationModel(provider: Provider, id: string): boolean {
  if (provider === 'anthropic') return true // Anthropic's /models catalog is text-generation-only.
  return !/(embedding|whisper|transcri|tts-|dall-e|moderation|realtime|audio|search-preview|computer-use)/i.test(id)
}

export async function GET(request: NextRequest) {
  const ctx = await requireAdminRole(request, 'admin_ai_config')
  if (isErrorResponse(ctx)) return ctx
  const provider = request.nextUrl.searchParams.get('provider')
  if (!PROVIDERS.includes(provider as Provider)) return apiError('VALIDATION_ERROR', 'Unsupported provider', 400)

  const feature = request.nextUrl.searchParams.get('feature')
  let config: Config | null = null
  if (feature) {
    const { data } = await ctx.admin.from('ai_feature_overrides')
      .select('compatible_base_url, anthropic_api_key_encrypted, openai_api_key_encrypted, openai_compatible_api_key_encrypted')
      .eq('feature', feature).maybeSingle()
    if (data) config = data
  }
  if (!config) {
    const { data, error } = await ctx.admin.from('ai_provider_config')
      .select('compatible_base_url, anthropic_api_key_encrypted, openai_api_key_encrypted, openai_compatible_api_key_encrypted')
      .eq('id', 1).single()
    if (error || !data) return apiError('SERVER_ERROR', 'Could not load model provider configuration', 500)
    config = data
  }

  const keyField = provider === 'anthropic' ? config.anthropic_api_key_encrypted
    : provider === 'openai' ? config.openai_api_key_encrypted
      : config.openai_compatible_api_key_encrypted
  const envKey = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY
    : provider === 'openai' ? process.env.OPENAI_API_KEY
      : process.env.OPENAI_COMPATIBLE_API_KEY
  let apiKey: string | undefined
  try {
    apiKey = keyField ? decryptSecret(keyField) : envKey
  } catch {
    return apiError('SERVER_ERROR', 'The configured provider key could not be decrypted', 500)
  }
  if (!apiKey && provider !== 'openai_compatible') return apiError('VALIDATION_ERROR', 'Configure an API key before loading models', 409)

  let endpoint: URL
  try {
    if (provider === 'anthropic') endpoint = new URL('https://api.anthropic.com/v1/models?limit=1000')
    else if (provider === 'openai') endpoint = new URL('https://api.openai.com/v1/models')
    else {
      const base = request.nextUrl.searchParams.get('base_url') || config.compatible_base_url
      if (!base) return apiError('VALIDATION_ERROR', 'Set a compatible provider base URL first', 409)
      endpoint = new URL(`${base.replace(/\/+$/, '')}/models`)
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
        return apiError('VALIDATION_ERROR', 'Base URL must use HTTP(S) and cannot contain credentials', 400)
    }
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid provider base URL', 400)
  }

  const headers: Record<string, string> = provider === 'anthropic'
    ? { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' }
    : apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  let response: Response
  try {
    response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  } catch {
    return apiError('SERVER_ERROR', 'Could not reach the provider model catalog', 502)
  }
  if (!response.ok) return apiError('SERVER_ERROR', `Provider model catalog returned HTTP ${response.status}`, 502)
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return apiError('SERVER_ERROR', 'Provider returned an invalid model catalog', 502)
  }
  const ids = modelIds(payload).filter((id) => isTextGenerationModel(provider as Provider, id))
  return NextResponse.json({ models: ids })
}
