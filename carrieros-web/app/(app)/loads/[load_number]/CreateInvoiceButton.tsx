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
      <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
        <h2 className="text-white font-medium text-sm mb-3">{t('billing')}</h2>
        <p className="text-slate-400 text-sm mb-3">{t('loadAlreadyInvoiced')}</p>
        <Link
          href={`/invoices/${existingInvoiceNumber}`}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-white/5 hover:bg-white/10 text-white text-sm font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          <span className="material-symbols-outlined text-[18px]">receipt_long</span>
          {existingInvoiceNumber}
        </Link>
      </div>
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
    <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
      <h2 className="text-white font-medium text-sm mb-3">{t('billing')}</h2>
      <p className="text-slate-400 text-sm mb-1">
        {t('createInvoicePrefill', { amount: amountLabel, customer: customerName ?? '—' })}
      </p>
      <p className="text-slate-500 text-xs mb-3">{t('createInvoiceNetTerms')}</p>
      <button
        onClick={create}
        disabled={pending}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
      >
        <span className="material-symbols-outlined text-[18px]">receipt_long</span>
        {pending ? t('creating') : t('createInvoice')}
      </button>
      {error && (
        <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-red-400 text-xs">
          {error}
        </div>
      )}
    </div>
  )
}
