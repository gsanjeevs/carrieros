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
import { Card, CardHeader, CardBody, Button, Input } from '@/components/ui'

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
      <Card>
        <CardHeader>
          <h2 className="text-text-pri font-medium text-sm">{t('actions')}</h2>
        </CardHeader>
        <CardBody className="space-y-2.5">
          <Button
            variant="primary"
            onClick={() => run(() => markInvoiceSent(invoiceId))}
            disabled={busy || status === 'paid'}
            className="w-full py-2.5 text-sm"
          >
            <span className="material-symbols-outlined text-[18px]">outgoing_mail</span>
            {t('markSent')}
          </Button>

          <Button
            variant="success"
            onClick={() => run(() => markInvoicePaid(invoiceId))}
            disabled={busy || status === 'paid'}
            className="w-full py-2.5 text-sm"
          >
            <span className="material-symbols-outlined text-[18px]">paid</span>
            {t('markPaid')}
          </Button>

          {/* This really does email the customer now (lib/send-email.ts, real
              SMTP send). Say so plainly, and be honest that it only reaches
              whoever's email is on file for the customer. */}
          <p className="text-text-mut text-xs mt-1 leading-relaxed">{t('markSentHelp')}</p>

          {warning && (
            <div className="mt-3 rounded-lg bg-warning/10 border border-warning/20 px-3 py-2.5 text-warning text-xs">
              {warning}
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-lg bg-danger/10 border border-danger/20 px-3 py-2.5 text-danger text-xs">
              {error}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Payment method */}
      <Card>
        <CardHeader>
          <h2 className="text-text-pri font-medium text-sm">{t('paymentMethod')}</h2>
        </CardHeader>
        <CardBody>
          <label className={labelCls}>{t('collectVia')}</label>
          <Input
            as="select"
            value={method}
            disabled={busy}
            onChange={(e) => changeMethod(e.target.value)}
          >
            <option value="other">{t('method_other')}</option>
            <option value="stripe">{t('method_stripe')}</option>
            <option value="factoring">{t('method_factoring')}</option>
          </Input>

          {method === 'stripe' && (
            /* Stripe is not implemented — no keys, no payment link. Show that
               plainly instead of a dead "Pay now" button. */
            <div className="mt-3 flex gap-2 rounded-lg bg-warning/10 border border-warning/20 px-3 py-2.5">
              <span className="material-symbols-outlined text-warning text-[16px]">info</span>
              <p className="text-warning text-xs leading-relaxed">{t('stripeNotConfigured')}</p>
            </div>
          )}

          {method === 'other' && (
            <p className="text-text-mut text-xs mt-3 leading-relaxed">{t('otherMethodHelp')}</p>
          )}
        </CardBody>
      </Card>

      {/* Factoring — only meaningful when this invoice is collected that way */}
      {method === 'factoring' && (
        <Card>
          <CardHeader>
            <h2 className="text-text-pri font-medium text-sm">{t('factoring')}</h2>
          </CardHeader>
          <CardBody>
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
                <Input
                  placeholder="TriumphPay"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>{t('factoringReference')}</label>
                <Input
                  placeholder="REF-12345"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>

              {/* Teal factoring accent has no components/ui/Button variant —
                  kept hand-rolled per the design system's factoring recipe,
                  not one of the banned ad hoc card/badge patterns. */}
              <button
                onClick={sendToFactoring}
                disabled={busy || !company.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#1abc9c] hover:bg-[#16a085] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
              >
                <span className="material-symbols-outlined text-[18px]">account_balance</span>
                {factorLoading ? t('sendingToFactoring') : t('sendToFactoring')}
              </button>
            </div>

            {/* Honest about the stub: no factoring partner is connected yet. */}
            <p className="text-text-mut text-xs mt-3 leading-relaxed">{t('factoringStubHelp')}</p>
          </CardBody>
        </Card>
      )}
    </>
  )
}
