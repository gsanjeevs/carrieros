'use client'
// app/(app)/invoices/EditInvoiceCard.tsx
// Review + edit an invoice's amount/due_date/notes before sending — closes
// docs/feature-completeness-audit.md's #3 gap. Draft-only by design (see
// updateInvoiceDraft()'s own comment in actions.ts) — renders nothing once
// an invoice has been sent, at which point InvoiceActions' Mark Sent/Paid
// buttons are the only status-changing controls left.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { updateInvoiceDraft, type ActionResult } from './actions'

const inputCls =
  'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/40 transition'
const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5'

export default function EditInvoiceCard({
  invoiceId,
  status,
  initialAmount,
  initialDueDate,
  initialNotes,
}: {
  invoiceId: number
  status: string
  initialAmount: number
  initialDueDate: string | null
  initialNotes: string | null
}) {
  const router = useRouter()
  const t = useTranslations('invoices')
  const tErrors = useTranslations('errors')
  const tCommon = useTranslations('common')
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(String(initialAmount))
  const [dueDate, setDueDate] = useState(initialDueDate ?? '')
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [error, setError] = useState('')

  if (status !== 'draft') return null

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  function save() {
    setError('')
    startTransition(async () => {
      const res: ActionResult = await updateInvoiceDraft(invoiceId, {
        amount: Number(amount),
        due_date: dueDate || null,
        notes: notes || null,
      })
      if (!res.ok) {
        setError(friendly(res.error_code))
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  function cancel() {
    setAmount(String(initialAmount))
    setDueDate(initialDueDate ?? '')
    setNotes(initialNotes ?? '')
    setError('')
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-white/5 hover:bg-white/10 border border-white/8 text-white text-sm font-medium rounded-xl transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
      >
        <span className="material-symbols-outlined text-[18px]">edit</span>
        {t('editInvoice')}
      </button>
    )
  }

  return (
    <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
      <h2 className="text-white font-medium text-sm mb-4">{t('editInvoice')}</h2>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>{t('amount')}</label>
          <input
            type="number"
            step="0.01"
            className={inputCls}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>{t('dueDate')}</label>
          <input
            type="date"
            className={inputCls}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>{t('notes')}</label>
          <textarea
            className={`${inputCls} min-h-[72px] resize-y`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-red-400 text-xs">
          {error}
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-white text-sm font-medium rounded-lg transition disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          {tCommon('cancel')}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending || !amount || Number(amount) <= 0}
          className="flex-1 py-2 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          {pending ? '…' : tCommon('save')}
        </button>
      </div>
    </div>
  )
}
