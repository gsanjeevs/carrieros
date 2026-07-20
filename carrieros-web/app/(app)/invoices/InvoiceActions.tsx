'use client'
// app/(app)/invoices/InvoiceActions.tsx
// Status transitions + payment method + the factoring hand-off.
//
// The status/payment-method writes go straight to Supabase through server
// actions (decisions.md R3b — plain RLS-protected CRUD needs no API route).
// Only the factoring hand-off calls an API route, because that is where a
// future secret-holding integration will live.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  markInvoiceSent,
  markInvoicePaid,
  setInvoicePaymentMethod,
  type ActionResult,
} from './actions'

const inputCls =
  'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-[#f97316] transition'
const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5'

interface Props {
  invoiceId: number
  status: string
  paymentMethod: string
  factoringCompany: string | null
  factoringReference: string | null
  factoredAtLabel: string | null
  defaultFactoringCompany: string
}

export default function InvoiceActions({
  invoiceId,
  status,
  paymentMethod,
  factoringCompany,
  factoringReference,
  factoredAtLabel,
  defaultFactoringCompany,
}: Props) {
  const router = useRouter()
  const t = useTranslations('invoices')
  const tErrors = useTranslations('errors')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [method, setMethod] = useState(paymentMethod)
  const [company, setCompany] = useState(factoringCompany ?? defaultFactoringCompany)
  const [reference, setReference] = useState(factoringReference ?? '')
  const [factorLoading, setFactorLoading] = useState(false)

  // `errors` messages are keyed by error_code — never render a raw API string.
  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  function run(fn: () => Promise<ActionResult>) {
    setError('')
    setWarning('')
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) {
        setError(friendly(res.error_code))
        return
      }
      if (res.warning_code === 'NO_RECIPIENT_EMAIL') {
        setWarning(t('sentNoRecipientWarning'))
      }
      router.refresh()
    })
  }

  function changeMethod(next: string) {
    const prev = method
    setMethod(next)
    setError('')
    startTransition(async () => {
      const res = await setInvoicePaymentMethod(invoiceId, next)
      if (!res.ok) {
        setMethod(prev)
        setError(friendly(res.error_code))
        return
      }
      router.refresh()
    })
  }

  async function sendToFactoring() {
    setError('')
    setFactorLoading(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/factor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factoring_company: company.trim(),
          factoring_reference: reference.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(friendly(json.error_code))
        return
      }
      router.refresh()
    } catch {
      setError(friendly('SERVER_ERROR'))
    } finally {
      setFactorLoading(false)
    }
  }

  const busy = pending || factorLoading

  return (
    <>
      {/* Status actions */}
      <div className="bg-white/5 border border-white/8 rounded-xl p-5">
        <h2 className="text-white font-medium text-sm mb-4">{t('actions')}</h2>

        <div className="space-y-2.5">
          <button
            onClick={() => run(() => markInvoiceSent(invoiceId))}
            disabled={busy || status === 'paid'}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition"
          >
            <span className="material-symbols-outlined text-[18px]">outgoing_mail</span>
            {t('markSent')}
          </button>

          <button
            onClick={() => run(() => markInvoicePaid(invoiceId))}
            disabled={busy || status === 'paid'}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#16a34a] hover:bg-[#15803d] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition"
          >
            <span className="material-symbols-outlined text-[18px]">paid</span>
            {t('markPaid')}
          </button>
        </div>

        {/* This really does email the customer now (lib/send-email.ts, real
            SMTP send). Say so plainly, and be honest that it only reaches
            whoever's email is on file for the customer. */}
        <p className="text-slate-500 text-xs mt-3 leading-relaxed">{t('markSentHelp')}</p>

        {warning && (
          <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 text-amber-400 text-xs">
            {warning}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-red-400 text-xs">
            {error}
          </div>
        )}
      </div>

      {/* Payment method */}
      <div className="bg-white/5 border border-white/8 rounded-xl p-5">
        <h2 className="text-white font-medium text-sm mb-4">{t('paymentMethod')}</h2>
        <label className={labelCls}>{t('collectVia')}</label>
        <select
          className={inputCls}
          value={method}
          disabled={busy}
          onChange={(e) => changeMethod(e.target.value)}
        >
          <option value="other">{t('method_other')}</option>
          <option value="stripe">{t('method_stripe')}</option>
          <option value="factoring">{t('method_factoring')}</option>
        </select>

        {method === 'stripe' && (
          /* Stripe is not implemented — no keys, no payment link. Show that
             plainly instead of a dead "Pay now" button. */
          <div className="mt-3 flex gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
            <span className="material-symbols-outlined text-amber-400 text-[16px]">info</span>
            <p className="text-amber-400 text-xs leading-relaxed">{t('stripeNotConfigured')}</p>
          </div>
        )}

        {method === 'other' && (
          <p className="text-slate-500 text-xs mt-3 leading-relaxed">{t('otherMethodHelp')}</p>
        )}
      </div>

      {/* Factoring — only meaningful when this invoice is collected that way */}
      {method === 'factoring' && (
        <div className="bg-white/5 border border-white/8 rounded-xl p-5">
          <h2 className="text-white font-medium text-sm mb-4">{t('factoring')}</h2>

          {factoredAtLabel && (
            <div className="mb-4 rounded-lg bg-[#1abc9c]/10 border border-[#1abc9c]/20 px-3 py-2.5">
              <p className="text-[#1abc9c] text-xs">
                {t('factoredOn', { date: factoredAtLabel, company: factoringCompany ?? '—' })}
              </p>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className={labelCls}>{t('factoringCompany')} *</label>
              <input
                className={inputCls}
                placeholder="TriumphPay"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>{t('factoringReference')}</label>
              <input
                className={inputCls}
                placeholder="REF-12345"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>

            <button
              onClick={sendToFactoring}
              disabled={busy || !company.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#1abc9c] hover:bg-[#16a085] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition"
            >
              <span className="material-symbols-outlined text-[18px]">account_balance</span>
              {factorLoading ? t('sendingToFactoring') : t('sendToFactoring')}
            </button>
          </div>

          {/* Honest about the stub: no factoring partner is connected yet. */}
          <p className="text-slate-500 text-xs mt-3 leading-relaxed">{t('factoringStubHelp')}</p>
        </div>
      )}
    </>
  )
}
