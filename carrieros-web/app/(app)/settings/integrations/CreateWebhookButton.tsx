'use client'
// app/(app)/settings/integrations/CreateWebhookButton.tsx
// Creates a webhook via POST /api/v1/webhooks (session-authenticated). The
// returned secret is shown exactly once, in its own confirmation modal,
// before the create form's modal closes — same "shown once" UX as
// CreateClientButton's client_secret (Developer API): the server never
// stores the plaintext secret anywhere it could be shown again.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Input, Modal } from '@/components/ui'

const EVENT_TYPES = ['load.delivered', 'load.status_changed', 'invoice.paid'] as const

export default function CreateWebhookButton() {
  const router = useRouter()
  const t = useTranslations('integrations')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<{ url: string; secret: string } | null>(null)
  const [copied, setCopied] = useState(false)

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  function toggleEvent(evt: string) {
    setEvents((prev) => (prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]))
  }

  function closeCreateForm() {
    if (loading) return
    setOpen(false)
    setUrl('')
    setEvents([])
    setError('')
  }

  function closeSecretReveal() {
    setCreated(null)
    setCopied(false)
    router.refresh()
  }

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), subscribed_events: events }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))

      setOpen(false)
      setUrl('')
      setEvents([])
      setCreated({ url: json.webhook.url, secret: json.secret })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value)
    setCopied(true)
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <span className="material-symbols-outlined text-[18px]">add</span>
        {t('createWebhook')}
      </Button>

      <Modal
        open={open}
        onClose={closeCreateForm}
        title={t('createWebhook')}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={closeCreateForm} disabled={loading}>
              {tCommon('cancel')}
            </Button>
            <Button size="sm" onClick={submit} disabled={loading || !url.trim() || events.length === 0} loading={loading}>
              {loading ? tCommon('loading') : t('create')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-sec mb-1.5">{t('webhookUrl')} *</label>
            <Input placeholder="https://example.com/webhooks/carrieros" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
            <p className="text-xs text-text-mut mt-1.5">{t('webhookUrlHelp')}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-sec mb-1.5">{t('subscribedEvents')} *</label>
            <div className="space-y-2">
              {EVENT_TYPES.map((evt) => (
                <label key={evt} className="flex items-center gap-2 text-sm text-text-pri">
                  <input type="checkbox" checked={events.includes(evt)} onChange={() => toggleEvent(evt)} />
                  <span className="font-mono text-xs">{evt}</span>
                </label>
              ))}
            </div>
          </div>
          {error && (
            <div className="rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
              {error}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={created !== null}
        onClose={closeSecretReveal}
        title={t('secretRevealTitle')}
        size="lg"
        footer={
          <Button size="sm" onClick={closeSecretReveal}>
            {t('secretRevealDone')}
          </Button>
        }
      >
        {created && (
          <div className="space-y-4">
            <div className="rounded-lg bg-warning/10 border border-warning/25 px-3 py-2.5 text-[11px] leading-relaxed text-warning">
              {t('secretRevealWarning')}
            </div>
            <div>
              <label className="block text-xs font-medium text-text-sec mb-1.5">{t('webhookSecret')}</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 block bg-surface-subtle border border-border-ui rounded-lg px-3 py-2 text-xs font-mono text-text-pri break-all">
                  {created.secret}
                </code>
                <Button variant="secondary" size="sm" onClick={() => copy(created.secret)}>
                  {copied ? tCommon('copied') : tCommon('copy')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
