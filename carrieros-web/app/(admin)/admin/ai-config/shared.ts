// app/(admin)/admin/ai-config/shared.ts
// Provider/key-field constants shared between page.tsx (platform-wide default) and
// FeatureOverrideCard.tsx (per-feature override) -- both render the identical
// provider/model/base-url/key-management shape against a different API route, so this is the one
// source of truth for that shape rather than two copies drifting apart.
export type Provider = 'anthropic' | 'openai' | 'openai_compatible'

export const REQUIRED_ENV_VAR: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openai_compatible: 'OPENAI_COMPATIBLE_API_KEY (optional — many self-hosted endpoints need none)',
}

export const KEY_FIELDS = [
  { provider: 'anthropic' as const, bodyField: 'anthropic_api_key' as const, configuredKey: 'anthropic_key_configured' as const, previewKey: 'anthropic_key_preview' as const, envVar: 'ANTHROPIC_API_KEY' },
  { provider: 'openai' as const, bodyField: 'openai_api_key' as const, configuredKey: 'openai_key_configured' as const, previewKey: 'openai_key_preview' as const, envVar: 'OPENAI_API_KEY' },
  { provider: 'openai_compatible' as const, bodyField: 'openai_compatible_api_key' as const, configuredKey: 'openai_compatible_key_configured' as const, previewKey: 'openai_compatible_key_preview' as const, envVar: 'OPENAI_COMPATIBLE_API_KEY' },
]

export interface KeyState {
  anthropic_key_configured: boolean
  anthropic_key_preview: string | null
  openai_key_configured: boolean
  openai_key_preview: string | null
  openai_compatible_key_configured: boolean
  openai_compatible_key_preview: string | null
}
