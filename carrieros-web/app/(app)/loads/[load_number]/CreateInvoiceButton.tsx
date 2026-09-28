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
  existingInvoices: Array<{ invoice_number: string; customer_org_id: number | null; customer_name: string | null }>
  expectedCustomerIds: Array<number | null>
  amountLabel: string
  customerName: string | null
}

export default function CreateInvoiceButton({
  loadId,
  billable,
  existingInvoices,
  expectedCustomerIds,
  amountLabel,
  customerName,
}: Props) {
  const router = useRouter()
  const t = useTranslations('invoices')
  const tErrors = useTranslations('errors')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const invoiceCustomerIds = new Set(existingInvoices.map((invoice) => invoice.customer_org_id))
  const hasMissingInvoices = expectedCustomerIds.some((customerId) => !invoiceCustomerIds.has(customerId))
  const canCreate = billable && hasMissingInvoices

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
      if (res.invoice_numbers?.length === 1) router.push(`/invoices/${res.invoice_numbers[0]}`)
      else router.push('/invoices')
    })
  }

  if (existingInvoices.length === 0 && !canCreate) return null
  return (
    <Card>
      <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('billing')}</h2></CardHeader>
      <CardBody>
        {existingInvoices.length > 0 && <>
          <p className="text-text-sec text-sm mb-3">{t('loadInvoicesCreated', { count: existingInvoices.length })}</p>
          <div className="space-y-2 mb-3">
            {existingInvoices.map((invoice) => (
              <Link key={invoice.invoice_number} href={`/invoices/${invoice.invoice_number}`} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-surface-subtle hover:bg-surface-subtle/70 rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
                <span className="text-text-pri text-sm font-medium">{invoice.invoice_number}</span>
                <span className="text-text-sec text-xs truncate">{invoice.customer_name ?? customerName ?? '—'}</span>
              </Link>
            ))}
          </div>
        </>}
        {canCreate && <>
          <p className="text-text-sec text-sm mb-1">{existingInvoices.length ? t('createRemainingCustomerInvoices') : t('createInvoicePrefill', { amount: amountLabel, customer: customerName ?? '—' })}</p>
          <p className="text-text-mut text-xs mb-3">{t('createInvoiceNetTerms')}</p>
          <Button onClick={create} disabled={pending} loading={pending} className="w-full py-2.5">
            <span className="material-symbols-outlined text-[18px]">receipt_long</span>
            {pending ? t('creating') : t('createInvoice')}
          </Button>
        </>}
        {error && <div className="mt-3 rounded-lg bg-danger/10 border border-danger/20 px-3 py-2.5 text-danger text-xs">{error}</div>}
      </CardBody>
    </Card>
  )
}
