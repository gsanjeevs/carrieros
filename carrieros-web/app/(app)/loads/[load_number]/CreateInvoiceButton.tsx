'use client'
// app/(app)/loads/[load_number]/CreateInvoiceButton.tsx
// Billing entry point on the load detail page. Renders one of three states:
//   - the load already has an invoice  → link to it (never a second create;
//     `invoices_load_unique` would reject it anyway)
//   - the load is delivered/invoiced   → create button, prefilled from the load
//   - anything else                    → nothing (billing isn't possible yet)

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { createInvoiceForLoad } from '@/app/(app)/invoices/actions'
import { Card, CardHeader, CardBody, Button } from '@/components/ui'

interface Props {
  loadId: number
  billable: boolean
  existingInvoiceNumber: string | null
  amountLabel: string
  customerName: string | null
}

export default function CreateInvoiceButton({
  loadId,
  billable,
  existingInvoiceNumber,
  amountLabel,
  customerName,
}: Props) {
  const router = useRouter()
  const t = useTranslations('invoices')
  const tErrors = useTranslations('errors')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  if (existingInvoiceNumber) {
    return (
      <Card>
        <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('billing')}</h2></CardHeader>
        <CardBody>
          <p className="text-text-sec text-sm mb-3">{t('loadAlreadyInvoiced')}</p>
          <Link
            href={`/invoices/${existingInvoiceNumber}`}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-surface-subtle hover:bg-surface-subtle/70 text-text-pri text-sm font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
          >
            <span className="material-symbols-outlined text-[18px]">receipt_long</span>
            {existingInvoiceNumber}
          </Link>
        </CardBody>
      </Card>
    )
  }

  if (!billable) return null

  function create() {
    setError('')
    startTransition(async () => {
      const res = await createInvoiceForLoad(loadId)
      if (!res.ok) {
        setError(tErrors(res.error_code))
        // INVOICE_EXISTS means someone else billed it — refresh so this
        // component re-renders into its "already invoiced" state.
        if (res.error_code === 'INVOICE_EXISTS') router.refresh()
        return
      }
      router.push(`/invoices/${res.invoice_number}`)
    })
  }

  return (
    <Card>
      <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('billing')}</h2></CardHeader>
      <CardBody>
        <p className="text-text-sec text-sm mb-1">
          {t('createInvoicePrefill', { amount: amountLabel, customer: customerName ?? '—' })}
        </p>
        <p className="text-text-mut text-xs mb-3">{t('createInvoiceNetTerms')}</p>
        <Button onClick={create} disabled={pending} loading={pending} className="w-full py-2.5">
          <span className="material-symbols-outlined text-[18px]">receipt_long</span>
          {pending ? t('creating') : t('createInvoice')}
        </Button>
        {error && (
          <div className="mt-3 rounded-lg bg-danger/10 border border-danger/20 px-3 py-2.5 text-danger text-xs">
            {error}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
