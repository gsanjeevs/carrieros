'use client'
// components/SendDocumentsButton.tsx
// POD/BOL/rate-con send-to-customer (PRD P0). Opens a modal to pick which
// already-uploaded load documents to attach, confirms/overrides the
// recipient email, and posts to POST /api/loads/:id/send-documents (real
// SMTP send with real file attachments, not a signed-link email).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Callout, Field, Input, Modal } from '@/components/ui'

interface DocOption {
  id: number
  type: string
  fileName: string
}

export default function SendDocumentsButton({
  loadId,
  documents,
  customerEmail,
}: {
  loadId: number
  documents: DocOption[]
  customerEmail: string | null
}) {
  const t = useTranslations('loads')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const router = useRouter()

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [email, setEmail] = useState(customerEmail ?? '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function close() {
    if (sending) return
    setOpen(false)
    setSelected(new Set())
    setEmail(customerEmail ?? '')
    setError('')
    setSuccess('')
  }

  async function submit() {
    setSending(true)
    setError('')
    try {
      const res = await fetch(`/api/loads/${loadId}/send-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_ids: [...selected],
          recipient_email: email.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))
      setSuccess(t('documentsSentSuccess', { email: json.sent_to, count: json.count }))
      setSelected(new Set())
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setSending(false)
    }
  }

  if (documents.length === 0) return null

  return (
    <>
      <Button variant="ghost" size="md" onClick={() => setOpen(true)}>
        <span className="material-symbols-outlined text-[16px]">forward_to_inbox</span>
        {t('sendToCustomer')}
      </Button>

      <Modal
        open={open}
        onClose={close}
        size="md"
        title={t('sendToCustomer')}
        className="max-h-[90vh] overflow-y-auto"
        footer={
          success ? (
            <Button onClick={close}>{tCommon('done')}</Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={close} disabled={sending}>
                {tCommon('cancel')}
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={sending || selected.size === 0 || !email.trim()}
                loading={sending}
              >
                {sending ? t('sendingDocuments') : t('sendDocuments')}
              </Button>
            </>
          )
        }
      >
        {success ? (
          <Callout tone="success">{success}</Callout>
        ) : (
          <div className="space-y-4">
            <Field label={t('recipientEmail')} htmlFor="send-documents-email">
              <Input
                id="send-documents-email"
                size="lg"
                type="email"
                placeholder="dispatch@customer.example"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <Field label={t('selectDocuments')}>
              <div className="space-y-1.5">
                {documents.map((doc) => (
                  <label key={doc.id} className="flex items-center gap-2.5 px-3 py-2 bg-surface-subtle border border-border-ui rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(doc.id)}
                      onChange={() => toggle(doc.id)}
                      className="accent-brand-orange"
                    />
                    <span className="text-text-pri text-sm truncate">{doc.fileName}</span>
                  </label>
                ))}
              </div>
            </Field>

            {error && <Callout tone="danger">{error}</Callout>}
          </div>
        )}
      </Modal>
    </>
  )
}
