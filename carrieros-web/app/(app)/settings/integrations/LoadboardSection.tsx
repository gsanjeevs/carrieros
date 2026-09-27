'use client'
// app/(app)/settings/integrations/LoadboardSection.tsx
// Settings > Integrations > Load Board (migration 0052, Phase 1 -- DAT, posting only, mocked
// client). Same shape as TelematicsSection.tsx's ProviderForm, simplified for a single provider and
// a single credential field (no webhook URL -- DAT posting has no inbound webhook in Phase 1).
//
// Same "no reveal affordance" posture as telematics: only `credentialConfigured` (boolean) is ever
// received for an existing row; leaving the input blank on save keeps the stored value, typing a new
// one rotates it.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Card, CardBody, CardHeader, Input } from '@/components/ui'

export interface LoadboardIntegrationInitial {
  provider: 'dat'
  enabled: boolean
  credentialConfigured: boolean
}

export default function LoadboardSection({
  integration,
}: {
  integration: LoadboardIntegrationInitial | null
}) {
  const router = useRouter()
  const t = useTranslations('loadboard')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  const [enabled, setEnabled] = useState(integration?.enabled ?? true)
  const [credential, setCredential] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [savedTick, setSavedTick] = useState(0)

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  const configured = integration?.credentialConfigured ?? false

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/loadboard-integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'dat',
          enabled,
          api_key: credential.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))

      setCredential('')
      setSavedTick((n) => n + 1)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-8">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-pri">{t('settingsTitle')}</h2>
        <p className="text-text-sec text-sm mt-1">{t('settingsSubtitle')}</p>
      </div>
      <Card>
        <CardHeader>
          <h3 className="text-text-pri font-medium text-sm">{t('datTitle')}</h3>
          <p className="text-text-sec text-xs mt-0.5">{t('datDescription')}</p>
        </CardHeader>
        <CardBody className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-text-pri">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t('enabled')}
          </label>

          <div>
            <label className="block text-xs font-medium text-text-sec mb-1.5">{t('apiKeyLabel')}</label>
            <Input
              type="password"
              placeholder={t('apiKeyPlaceholder')}
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
            />
            <p className="text-xs text-text-mut mt-1.5">
              {configured ? t('apiKeyConfigured') : t('apiKeyNotConfigured')}
            </p>
          </div>

          {!configured && !credential.trim() && (
            <p className="text-xs text-warning">{t('credentialRequired')}</p>
          )}

          {error && (
            <div className="rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={submit}
              disabled={loading || (!configured && !credential.trim())}
              loading={loading}
            >
              {loading ? tCommon('loading') : t('save')}
            </Button>
            {savedTick > 0 && !loading && <span className="text-xs text-success">{t('saved')}</span>}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
