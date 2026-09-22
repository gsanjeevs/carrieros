'use client'
// app/(admin)/admin/ai-config/page.tsx — LLM Provider (decisions.md T17).
// Lets sx_owner pick which provider (Anthropic / OpenAI / any OpenAI-compatible endpoint) every
// LLM call in the app (load extraction, support-ticket triage) goes through, plus the model string
// and — for openai_compatible only — the base URL. GET/PUT /api/admin/ai-config, gated on
// admin_ai_config (sx_owner only).
//
// Follows app/(admin)/admin/flags/page.tsx's structure closely: components/ui/* per
// docs/design/carrieros-design-system.md §5, same load/save/error pattern, same deferred-microtask
// initial fetch (react-hooks/set-state-in-effect).
//
// The API-key field is deliberately NOT here — provider credentials live in environment variables
// only (decisions.md T17), never the database. This page shows, read-only, which env var the
// selected provider needs so an operator knows what to check without it ever being an input.
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
}

const REQUIRED_ENV_VAR: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openai_compatible: 'OPENAI_COMPATIBLE_API_KEY (optional — many self-hosted endpoints need none)',
}

export default function AiConfigPage() {
  const t = useTranslations('admin.aiConfig')
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [provider, setProvider] = useState<Provider>('openai')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')

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

  async function save() {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const res = await fetch('/api/admin/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          compatible_base_url: provider === 'openai_compatible' ? baseUrl : null,
        }),
      })
      if (!res.ok) throw new Error()
      const json = await res.json()
      setConfig(json.config)
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
