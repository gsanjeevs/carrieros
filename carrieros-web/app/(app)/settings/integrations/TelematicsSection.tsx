'use client'
// app/(app)/settings/integrations/TelematicsSection.tsx
// Settings > Integrations > Telematics (migration 0042, user request: "is there a way to register a
// GPS ID with a vehicle" + a real Samsara/Motive integration). Owner/solo only, same gate as the
// webhooks section above it on this page (subscription_management). Two independent forms, one per
// vendor, each PUTting to /api/v1/telematics-integrations — see
// server/application/telematics-service.ts for what actually happens server-side (encryption,
// validation).
//
// Neither credential is ever fetched back in plaintext: `credentialConfigured` (boolean) is all this
// component ever receives from the server for an existing row, same "no reveal affordance" posture
// as /admin/ai-config's LLM provider keys. Leaving the input blank on save keeps the stored value;
// typing a new one rotates it.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Card, CardBody, CardHeader, Input } from '@/components/ui'

export interface TelematicsIntegrationInitial {
  provider: 'samsara' | 'motive'
  enabled: boolean
  credentialConfigured: boolean
}

function ProviderForm({
  provider,
  initial,
  webhookUrl,
}: {
  provider: 'samsara' | 'motive'
  initial: TelematicsIntegrationInitial | null
  webhookUrl?: string
}) {
  const router = useRouter()
  const t = useTranslations('telematics')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
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

  const configured = initial?.credentialConfigured ?? false
  const credentialField = provider === 'samsara' ? 'api_key' : 'webhook_secret'

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/telematics-integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          enabled,
          [credentialField]: credential.trim() || undefined,
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
    <Card>
      <CardHeader>
        <h3 className="text-text-pri font-medium text-sm">{t(provider === 'samsara' ? 'samsaraTitle' : 'motiveTitle')}</h3>
        <p className="text-text-sec text-xs mt-0.5">{t(provider === 'samsara' ? 'samsaraDescription' : 'motiveDescription')}</p>
      </CardHeader>
      <CardBody className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-text-pri">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('enabled')}
        </label>

        {provider === 'motive' && webhookUrl && (
          <div>
            <label className="block text-xs font-medium text-text-sec mb-1.5">{t('webhookUrlLabel')}</label>
            <code className="block bg-surface-subtle border border-border-ui rounded-lg px-3 py-2 text-xs font-mono text-text-pri break-all">
              {webhookUrl}
            </code>
            <p className="text-xs text-text-mut mt-1.5">{t('webhookUrlHelp')}</p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-text-sec mb-1.5">
            {t(provider === 'samsara' ? 'apiKeyLabel' : 'webhookSecretLabel')}
          </label>
          <Input
            type="password"
            placeholder={t(provider === 'samsara' ? 'apiKeyPlaceholder' : 'webhookSecretPlaceholder')}
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
          />
          <p className="text-xs text-text-mut mt-1.5">
            {configured
              ? t(provider === 'samsara' ? 'apiKeyConfigured' : 'webhookSecretConfigured')
              : t(provider === 'samsara' ? 'apiKeyNotConfigured' : 'webhookSecretNotConfigured')}
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
  )
}

export default function TelematicsSection({
  integrations,
  orgId,
}: {
  integrations: TelematicsIntegrationInitial[]
  orgId: number
}) {
  const t = useTranslations('telematics')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')
  const motiveWebhookUrl = `${appUrl}/api/webhooks/telematics/motive/${orgId}`

  const samsara = integrations.find((i) => i.provider === 'samsara') ?? null
  const motive = integrations.find((i) => i.provider === 'motive') ?? null

  return (
    <div className="mt-8">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-pri">{t('title')}</h2>
        <p className="text-text-sec text-sm mt-1">{t('subtitle')}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ProviderForm provider="samsara" initial={samsara} />
        <ProviderForm provider="motive" initial={motive} webhookUrl={motiveWebhookUrl} />
      </div>
    </div>
  )
}
