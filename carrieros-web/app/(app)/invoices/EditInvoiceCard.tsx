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
import { Card, CardHeader, CardBody, Button, Input } from '@/components/ui'

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
      <Button variant="secondary" className="w-full" onClick={() => setEditing(true)}>
        <span className="material-symbols-outlined text-[18px]">edit</span>
        {t('editInvoice')}
      </Button>
    )
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-white font-medium text-sm">{t('editInvoice')}</h2>
      </CardHeader>
      <CardBody>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>{t('amount')}</label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>{t('dueDate')}</label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>{t('notes')}</label>
            <Input
              as="textarea"
              className="min-h-[72px] resize-y"
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
          <Button variant="secondary" className="flex-1" onClick={cancel} disabled={pending}>
            {tCommon('cancel')}
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={save}
            disabled={pending || !amount || Number(amount) <= 0}
            loading={pending}
          >
            {tCommon('save')}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
