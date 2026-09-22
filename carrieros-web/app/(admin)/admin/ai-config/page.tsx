'use client'
// app/(admin)/admin/ai-config/page.tsx — LLM Provider (decisions.md T17, amended 2026-09-22).
// Lets sx_owner pick which provider (Anthropic / OpenAI / any OpenAI-compatible endpoint) every
// LLM call in the app (load extraction, support-ticket triage) goes through, plus the model string
// and — for openai_compatible only — the base URL. GET/PUT /api/admin/ai-config, gated on
// admin_ai_config (sx_owner only).
//
// Follows app/(admin)/admin/flags/page.tsx's structure closely: components/ui/* per
// docs/design/carrieros-design-system.md §5, same load/save/error pattern, same deferred-microtask
// initial fetch (react-hooks/set-state-in-effect).
//
// API keys: each provider now has its own password-style input here (T17's 2026-09-22 amendment) —
// left blank, a save leaves the existing stored key untouched; typed into, a save encrypts and
// stores it (rotates/sets it); "Clear" removes the stored key so that provider falls back to its
// environment variable again. The input's placeholder shows the current masked preview
// ("••••••••ab12") or "Not set" — there is NO way to reveal a full stored key anywhere on this page,
// by design (T17: no "reveal" affordance). The server never returns a decrypted value.
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, Button, Input, Field, Callout } from '@/components/ui'

type Provider = 'anthropic' | 'openai' | 'openai_compatible'

interface AiConfig {
  provider: Provider
  model: string
  compatible_base_url: string | null
  updated_at: string
  updated_by: string | null
  anthropic_key_configured: boolean
  anthropic_key_preview: string | null
  openai_key_configured: boolean
  openai_key_preview: string | null
  openai_compatible_key_configured: boolean
  openai_compatible_key_preview: string | null
}

const REQUIRED_ENV_VAR: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openai_compatible: 'OPENAI_COMPATIBLE_API_KEY (optional — many self-hosted endpoints need none)',
}

// One entry per provider's key field — drives both the three key-input sections below and the body
// this page sends to PUT /api/admin/ai-config.
const KEY_FIELDS = [
  { provider: 'anthropic' as const, bodyField: 'anthropic_api_key' as const, configuredKey: 'anthropic_key_configured' as const, previewKey: 'anthropic_key_preview' as const, envVar: 'ANTHROPIC_API_KEY' },
  { provider: 'openai' as const, bodyField: 'openai_api_key' as const, configuredKey: 'openai_key_configured' as const, previewKey: 'openai_key_preview' as const, envVar: 'OPENAI_API_KEY' },
  { provider: 'openai_compatible' as const, bodyField: 'openai_compatible_api_key' as const, configuredKey: 'openai_compatible_key_configured' as const, previewKey: 'openai_compatible_key_preview' as const, envVar: 'OPENAI_COMPATIBLE_API_KEY' },
]

export default function AiConfigPage() {
  const t = useTranslations('admin.aiConfig')
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [provider, setProvider] = useState<Provider>('openai')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')

  // Keyed by bodyField ('anthropic_api_key', etc). A non-empty string here means "set/rotate this
  // key on save"; `clear[bodyField] = true` means "remove the stored key on save" — the two are
  // mutually exclusive in the UI (typing into the field un-checks Clear, see onChange below).
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [keyClears, setKeyClears] = useState<Record<string, boolean>>({})

  async function load() {
    try {
      const res = await fetch('/api/admin/ai-config')
      if (!res.ok) throw new Error()
      const json = await res.json()
      const c = json.config as AiConfig
      setConfig(c)
      setProvider(c.provider)
      setModel(c.model)
      setBaseUrl(c.compatible_base_url ?? '')
    } catch {
      setError(t('error'))
    }
  }

  useEffect(() => {
    // Deferred a microtask so the initial fetch's state updates are not a
    // synchronous setState in the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function setKeyInput(bodyField: string, value: string) {
    setKeyInputs((prev) => ({ ...prev, [bodyField]: value }))
    if (value) setKeyClears((prev) => ({ ...prev, [bodyField]: false }))
  }

  function toggleClear(bodyField: string) {
    setKeyClears((prev) => ({ ...prev, [bodyField]: !prev[bodyField] }))
    setKeyInputs((prev) => ({ ...prev, [bodyField]: '' }))
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const body: Record<string, unknown> = {
        provider,
        model,
        compatible_base_url: provider === 'openai_compatible' ? baseUrl : null,
      }
      for (const field of KEY_FIELDS) {
        if (keyClears[field.bodyField]) {
          body[field.bodyField] = '' // explicit clear signal
        } else if (keyInputs[field.bodyField]) {
          body[field.bodyField] = keyInputs[field.bodyField]
        }
        // else: omitted entirely -> existing stored key (if any) is left untouched
      }

      const res = await fetch('/api/admin/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      const json = await res.json()
      setConfig(json.config)
      setKeyInputs({})
      setKeyClears({})
      setSaved(true)
    } catch {
      setError(t('saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (error && !config) return <div className="p-8 text-danger text-sm">{error}</div>
  if (!config) return <div className="p-8 text-text-sec text-sm">{t('loading')}</div>

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-semibold text-text-pri mb-1">{t('title')}</h1>
      <p className="text-text-sec text-sm mb-6">{t('subtitle')}</p>

      <Card className="p-5 flex flex-col gap-4">
        <Field label={t('providerLabel')} required>
          <Input as="select" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            <option value="openai">{t('providerOpenai')}</option>
            <option value="anthropic">{t('providerAnthropic')}</option>
            <option value="openai_compatible">{t('providerOpenaiCompatible')}</option>
          </Input>
        </Field>

        <Field label={t('modelLabel')} required hint={t('modelHint')}>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-5-mini" />
        </Field>

        {provider === 'openai_compatible' && (
          <Field label={t('baseUrlLabel')} required hint={t('baseUrlHint')}>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-endpoint/v1" />
          </Field>
        )}

        <Callout tone="info">{t('envVarNotice', { envVar: REQUIRED_ENV_VAR[provider] })}</Callout>

        <div className="flex flex-col gap-3 pt-1 border-t border-border-ui">
          <p className="text-2xs font-bold uppercase tracking-[1px] text-text-sec pt-3">{t('keysHeading')}</p>
          {KEY_FIELDS.map((field) => {
            const configured = config[field.configuredKey]
            const preview = config[field.previewKey]
            const clearing = !!keyClears[field.bodyField]
            return (
              <Field
                key={field.bodyField}
                label={t(`keyLabel.${field.provider}`)}
                hint={
                  clearing
                    ? t('keyWillClear')
                    : configured
                      ? t('keyConfiguredHint', { envVar: field.envVar })
                      : t('keyNotConfiguredHint', { envVar: field.envVar })
                }
              >
                <div className="flex gap-2">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={keyInputs[field.bodyField] ?? ''}
                    onChange={(e) => setKeyInput(field.bodyField, e.target.value)}
                    placeholder={clearing ? t('keyWillClear') : (preview ?? t('keyNotSet'))}
                    disabled={clearing}
                    className="flex-1"
                  />
                  {configured && (
                    <Button
                      type="button"
                      variant={clearing ? 'danger' : 'ghost'}
                      size="sm"
                      onClick={() => toggleClear(field.bodyField)}
                    >
                      {clearing ? t('keyClearing') : t('keyClearButton')}
                    </Button>
                  )}
                </div>
              </Field>
            )
          })}
        </div>

        {config.updated_at && (
          <p className="text-text-mut text-2xs">
            {t('lastUpdated', { date: new Date(config.updated_at).toLocaleString() })}
          </p>
        )}

        {error && <p className="text-danger text-xs">{error}</p>}
        {saved && !error && <p className="text-success text-xs">{t('saveSuccess')}</p>}

        <div>
          <Button onClick={save} loading={saving} disabled={!model.trim() || (provider === 'openai_compatible' && !baseUrl.trim())}>
            {t('saveButton')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
