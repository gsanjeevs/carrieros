'use client'
// app/(admin)/admin/ai-config/FeatureOverrideCard.tsx
// One card per AI_FEATURES entry (lib/ai/index.ts) — lets sx_owner pin a single feature (currently
// just 'translation') to a different provider/model than the platform-wide default in page.tsx,
// without touching every other AI feature's config (migration 0036, decisions.md T17). Backed by
// GET/PUT/DELETE /api/admin/ai-config/features/[feature] — that API has existed since the migration
// but had no UI anywhere until now.
//
// "Use platform default" vs "Custom for this feature" is a SegmentedControl over two states, not a
// tri-state: DELETE-ing the override (reverting to default) is the only way this card ever removes a
// row, matching the API's own self-contained-row semantics (GET returns { override: null } to mean
// "uses the default", never a partial/merged row).
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, Button, Input, Field, Callout, SegmentedControl } from '@/components/ui'
import type { AiFeature } from '@/lib/ai/types'
import { REQUIRED_ENV_VAR, KEY_FIELDS, type Provider, type KeyState } from './shared'

interface FeatureOverride extends KeyState {
  feature: string
  provider: Provider
  model: string
  compatible_base_url: string | null
  updated_at: string
  updated_by: string | null
}

const FEATURE_LABEL_KEY: Record<AiFeature, string> = {
  translation: 'translation',
}

export default function FeatureOverrideCard({
  feature,
  platformDefault,
}: {
  feature: AiFeature
  platformDefault: { provider: Provider; model: string }
}) {
  const t = useTranslations('admin.aiConfig')
  const [override, setOverride] = useState<FeatureOverride | null | undefined>(undefined) // undefined = still loading
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [mode, setMode] = useState<'default' | 'custom'>('default')
  const [provider, setProvider] = useState<Provider>('openai')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [keyClears, setKeyClears] = useState<Record<string, boolean>>({})

  async function load() {
    try {
      const res = await fetch(`/api/admin/ai-config/features/${feature}`)
      if (!res.ok) throw new Error()
      const json = await res.json()
      const o = json.override as FeatureOverride | null
      setOverride(o)
      if (o) {
        setMode('custom')
        setProvider(o.provider)
        setModel(o.model)
        setBaseUrl(o.compatible_base_url ?? '')
      } else {
        setMode('default')
      }
    } catch {
      setError(t('featureOverride.error'))
    }
  }

  useEffect(() => {
    // Deferred a microtask so the initial fetch's state updates are not a
    // synchronous setState in the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature])

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
      if (mode === 'default') {
        // Only DELETE when a row actually exists — an idle "already on default" card saving is a
        // no-op, not an error.
        if (override) {
          const res = await fetch(`/api/admin/ai-config/features/${feature}`, { method: 'DELETE' })
          if (!res.ok) throw new Error()
        }
        setOverride(null)
        setKeyInputs({})
        setKeyClears({})
      } else {
        const body: Record<string, unknown> = {
          provider,
          model,
          compatible_base_url: provider === 'openai_compatible' ? baseUrl : null,
        }
        for (const field of KEY_FIELDS) {
          if (keyClears[field.bodyField]) body[field.bodyField] = ''
          else if (keyInputs[field.bodyField]) body[field.bodyField] = keyInputs[field.bodyField]
        }
        const res = await fetch(`/api/admin/ai-config/features/${feature}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error()
        const json = await res.json()
        setOverride(json.override)
        setKeyInputs({})
        setKeyClears({})
      }
      setSaved(true)
    } catch {
      setError(t('featureOverride.saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (override === undefined) return <Card className="p-5 text-text-sec text-sm">{t('loading')}</Card>

  return (
    <Card className="p-5 flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-text-pri">{t(`featureOverride.featureLabel.${FEATURE_LABEL_KEY[feature]}`)}</h3>
        <p className="text-text-sec text-xs mt-0.5">{t('featureOverride.usingDefaultNotice', { provider: platformDefault.provider, model: platformDefault.model })}</p>
      </div>

      <SegmentedControl
        items={[
          { value: 'default', label: t('featureOverride.modeDefault') },
          { value: 'custom', label: t('featureOverride.modeCustom') },
        ]}
        value={mode}
        onChange={(v) => setMode(v as 'default' | 'custom')}
      />

      {mode === 'custom' && (
        <>
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
              const configured = override ? override[field.configuredKey] : false
              const preview = override ? override[field.previewKey] : null
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
        </>
      )}

      {override?.updated_at && (
        <p className="text-text-mut text-2xs">{t('lastUpdated', { date: new Date(override.updated_at).toLocaleString() })}</p>
      )}

      {error && <p className="text-danger text-xs">{error}</p>}
      {saved && !error && <p className="text-success text-xs">{t('saveSuccess')}</p>}

      <div>
        <Button
          onClick={save}
          loading={saving}
          disabled={mode === 'custom' && (!model.trim() || (provider === 'openai_compatible' && !baseUrl.trim()))}
        >
          {t('saveButton')}
        </Button>
      </div>
    </Card>
  )
}
