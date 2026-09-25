'use client'
// app/(app)/settings/integrations/WebhookActions.tsx
// Per-webhook row actions: view recent deliveries, rotate secret (shown once,
// same UX as create), enable/disable, delete. Mirrors RevokeClientButton's
// confirm-destructive pattern for delete.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Modal, StatusBadge } from '@/components/ui'

interface Webhook {
  id: number
  url: string
  enabled: boolean
  subscribedEvents: string[]
}

interface Delivery {
  id: number
  event_type: string
  status: 'pending' | 'success' | 'failed'
  attempt_count: number
  last_attempted_at: string | null
  last_response_status: number | null
  created_at: string
}

export default function WebhookActions({ webhook }: { webhook: Webhook }) {
  const router = useRouter()
  const t = useTranslations('integrations')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null)
  const [loadingDeliveries, setLoadingDeliveries] = useState(false)

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  async function toggleEnabled() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/webhooks/${webhook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !webhook.enabled }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(friendly(json.error_code))
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setBusy(false)
    }
  }

  async function rotateSecret() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/webhooks/${webhook.id}/rotate-secret`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))
      setRotatedSecret(json.secret)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/webhooks/${webhook.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(friendly(json.error_code))
      setConfirmingDelete(false)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setBusy(false)
    }
  }

  async function openDeliveries() {
    setLoadingDeliveries(true)
    setDeliveries([])
    try {
      const res = await fetch(`/api/v1/webhooks/${webhook.id}/deliveries`)
      const json = await res.json()
      if (res.ok) setDeliveries(json.deliveries)
    } finally {
      setLoadingDeliveries(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-3">
      <button
        onClick={openDeliveries}
        className="text-text-sec hover:text-text-pri transition text-xs"
      >
        {t('viewDeliveries')}
      </button>
      <button onClick={toggleEnabled} disabled={busy} className="text-text-sec hover:text-text-pri transition text-xs">
        {webhook.enabled ? t('disable') : t('enable')}
      </button>
      <button onClick={rotateSecret} disabled={busy} className="text-text-sec hover:text-text-pri transition text-xs">
        {t('rotateSecret')}
      </button>
      <button
        onClick={() => { setError(''); setConfirmingDelete(true) }}
        className="text-text-sec hover:text-danger transition text-xs"
      >
        {t('delete')}
      </button>

      <Modal
        open={confirmingDelete}
        onClose={() => { if (!busy) { setConfirmingDelete(false); setError('') } }}
        size="sm"
        title={t('deleteTitle')}
        variant="confirm-destructive"
        onConfirm={remove}
        confirmLabel={busy ? tCommon('loading') : t('delete')}
      >
        <p className="text-text-sec text-sm">{t('deleteConfirm', { url: webhook.url })}</p>
        {error && (
          <div className="mt-4 rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">{error}</div>
        )}
      </Modal>

      <Modal
        open={rotatedSecret !== null}
        onClose={() => { setRotatedSecret(null); router.refresh() }}
        title={t('secretRevealTitle')}
        size="lg"
        footer={
          <Button size="sm" onClick={() => { setRotatedSecret(null); router.refresh() }}>
            {t('secretRevealDone')}
          </Button>
        }
      >
        {rotatedSecret && (
          <div className="space-y-4">
            <div className="rounded-lg bg-warning/10 border border-warning/25 px-3 py-2.5 text-[11px] leading-relaxed text-warning">
              {t('secretRevealWarning')}
            </div>
            <code className="block bg-surface-subtle border border-border-ui rounded-lg px-3 py-2 text-xs font-mono text-text-pri break-all">
              {rotatedSecret}
            </code>
          </div>
        )}
      </Modal>

      <Modal open={deliveries !== null} onClose={() => setDeliveries(null)} title={t('deliveriesTitle')} size="lg">
        {loadingDeliveries ? (
          <p className="text-text-sec text-sm">{tCommon('loading')}</p>
        ) : deliveries && deliveries.length === 0 ? (
          <p className="text-text-sec text-sm">{t('noDeliveries')}</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {deliveries?.map((d) => (
              <div key={d.id} className="flex items-center justify-between border-b border-border-ui py-2 text-xs">
                <span className="font-mono">{d.event_type}</span>
                <span className="text-text-sec">{d.last_attempted_at ?? d.created_at}</span>
                <span className="text-text-sec">{d.last_response_status ?? '—'}</span>
                <StatusBadge variant={d.status === 'success' ? 'success' : d.status === 'failed' ? 'danger' : 'neutral'} size="sm">
                  {d.status}
                </StatusBadge>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {error && !confirmingDelete && (
        <div className="rounded-lg bg-danger/10 border border-danger/20 px-3 py-1.5 text-danger text-xs">{error}</div>
      )}
    </div>
  )
}
