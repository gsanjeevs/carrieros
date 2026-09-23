'use client'
// app/(app)/settings/developer-api/CreateClientButton.tsx
// Creates a client via POST /api/v1/oauth-clients (session-authenticated —
// this manages the public API, it does not call the public API). The
// returned client_secret is shown exactly once, in its own confirmation
// modal, before the create form's modal closes — standard practice for API
// credentials (GitHub tokens, Stripe keys, ...): there is no "view secret
// again" anywhere else in this app because the server never stores it.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Input, Modal } from '@/components/ui'

export default function CreateClientButton() {
  const router = useRouter()
  const t = useTranslations('developerApi')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<{ clientId: string; clientSecret: string } | null>(null)
  const [copied, setCopied] = useState<'id' | 'secret' | null>(null)

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  function closeCreateForm() {
    if (loading) return
    setOpen(false)
    setName('')
    setError('')
  }

  function closeSecretReveal() {
    setCreated(null)
    setCopied(null)
    router.refresh()
  }

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/oauth-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))

      setOpen(false)
      setName('')
      setCreated({ clientId: json.client.client_id, clientSecret: json.client_secret })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  async function copy(value: string, which: 'id' | 'secret') {
    await navigator.clipboard.writeText(value)
    setCopied(which)
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <span className="material-symbols-outlined text-[18px]">add</span>
        {t('createClient')}
      </Button>

      <Modal
        open={open}
        onClose={closeCreateForm}
        title={t('createClient')}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={closeCreateForm} disabled={loading}>
              {tCommon('cancel')}
            </Button>
            <Button size="sm" onClick={submit} disabled={loading || !name.trim()} loading={loading}>
              {loading ? tCommon('loading') : t('create')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-sec mb-1.5">{t('clientName')} *</label>
            <Input
              placeholder={t('clientNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-text-mut mt-1.5">{t('clientNameHelp')}</p>
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
              <label className="block text-xs font-medium text-text-sec mb-1.5">{t('clientId')}</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 block bg-surface-subtle border border-border-ui rounded-lg px-3 py-2 text-xs font-mono text-text-pri break-all">
                  {created.clientId}
                </code>
                <Button variant="secondary" size="sm" onClick={() => copy(created.clientId, 'id')}>
                  {copied === 'id' ? tCommon('copied') : tCommon('copy')}
                </Button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-sec mb-1.5">{t('clientSecret')}</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 block bg-surface-subtle border border-border-ui rounded-lg px-3 py-2 text-xs font-mono text-text-pri break-all">
                  {created.clientSecret}
                </code>
                <Button variant="secondary" size="sm" onClick={() => copy(created.clientSecret, 'secret')}>
                  {copied === 'secret' ? tCommon('copied') : tCommon('copy')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
