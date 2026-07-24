'use client'
// components/SendDocumentsButton.tsx
// POD/BOL/rate-con send-to-customer (PRD P0). Opens a modal to pick which
// already-uploaded load documents to attach, confirms/overrides the
// recipient email, and posts to POST /api/loads/:id/send-documents (real
// SMTP send with real file attachments, not a signed-link email).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

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
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/8 text-white text-xs font-medium rounded-lg transition"
      >
        <span className="material-symbols-outlined text-[16px]">forward_to_inbox</span>
        {t('sendToCustomer')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-md bg-navy border border-white/10 rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">{t('sendToCustomer')}</h2>
              <button onClick={close} className="text-slate-500 hover:text-white transition rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {success ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-success/10 border border-success/20 px-4 py-3 text-success text-sm">
                  {success}
                </div>
                <button
                  onClick={close}
                  className="w-full py-2.5 bg-brand-orange hover:bg-brand-orange-hover text-white font-semibold rounded-lg transition text-sm"
                >
                  {tCommon('done')}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">{t('recipientEmail')}</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand-orange transition"
                    type="email"
                    placeholder="dispatch@customer.example"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">{t('selectDocuments')}</label>
                  <div className="space-y-1.5">
                    {documents.map((doc) => (
                      <label key={doc.id} className="flex items-center gap-2.5 px-3 py-2 bg-white/5 border border-white/8 rounded-lg cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected.has(doc.id)}
                          onChange={() => toggle(doc.id)}
                          className="accent-brand-orange"
                        />
                        <span className="text-white text-sm truncate">{doc.fileName}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <div className="flex gap-3 mt-2">
                  <button
                    onClick={close}
                    disabled={sending}
                    className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white font-medium rounded-lg transition text-sm"
                  >
                    {tCommon('cancel')}
                  </button>
                  <button
                    onClick={submit}
                    disabled={sending || selected.size === 0 || !email.trim()}
                    className="flex-2 flex-grow py-2.5 bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition text-sm"
                  >
                    {sending ? t('sendingDocuments') : t('sendDocuments')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
