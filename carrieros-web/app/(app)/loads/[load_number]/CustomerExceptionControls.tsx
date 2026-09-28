'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardBody, CardHeader, Button } from '@/components/ui'

type CustomerException = {
  id: number
  title: string
  detail: string | null
  severity: string | null
  occurred_at: string
  customer_visible: boolean
  customer_message: string | null
}

export default function CustomerExceptionControls({ loadId, exceptions }: { loadId: number; exceptions: CustomerException[] }) {
  const t = useTranslations('loads')
  const [rows, setRows] = useState(exceptions)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function save(id: number, formData: FormData, resend = false) {
    const row = rows.find((item) => item.id === id)
    if (!row) return
    setSavingId(id)
    setError('')
    setNotice('')
    const visible = !row.customer_visible
    const customerMessage = String(formData.get('customer_message') ?? '').trim()
    const nextVisible = resend || visible
    const nextMessage = resend ? row.customer_message : customerMessage
    try {
      const response = await fetch(`/api/loads/${loadId}/customer-exceptions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exception_id: id, visible: nextVisible, resend, customer_message: nextMessage }),
      })
      if (!response.ok) throw new Error(t('customerExceptionSaveFailed'))
      const result = await response.json() as { notification?: { status?: string; recipient_count?: number; failed_count?: number } }
      setRows((current) => current.map((item) => item.id === id ? {
        ...item, customer_visible: nextVisible, customer_message: nextVisible ? nextMessage : null,
      } : item))
      if (resend || visible) {
        const status = result.notification?.status
        setNotice(status === 'sent'
          ? t('customerUpdateEmailSent', { count: result.notification?.recipient_count ?? 0 })
          : status === 'partially_sent' ? t('customerUpdateEmailPartial', { sent: result.notification?.recipient_count ?? 0, failed: result.notification?.failed_count ?? 0 })
          : status === 'no_recipient' ? t('customerUpdateNoRecipient')
            : status === 'failed' ? t('customerUpdateEmailFailed') : '')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('customerExceptionSaveFailed'))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-text-pri font-medium text-sm">{t('customerExceptionUpdates')}</h2>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? <p className="text-text-sec text-sm">{t('noCustomerExceptions')}</p> : (
          <div className="space-y-4">
            {rows.map((row) => (
              <form key={row.id} action={(data) => save(row.id, data)} className="rounded-lg border border-border-ui p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-text-pri text-sm font-medium">{row.title}</p>
                    {row.detail && <p className="mt-1 text-text-sec text-xs">{row.detail}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${row.customer_visible ? 'bg-success/10 text-success' : 'bg-surface-subtle text-text-mut'}`}>
                    {row.customer_visible ? t('customerUpdateShared') : t('customerUpdatePrivate')}
                  </span>
                </div>
                {!row.customer_visible ? (
                  <>
                    <label className="mt-3 block text-xs text-text-sec" htmlFor={`customer-message-${row.id}`}>{t('customerUpdateMessageLabel')}</label>
                    <textarea id={`customer-message-${row.id}`} name="customer_message" maxLength={280} required rows={2} defaultValue={row.customer_message ?? ''} className="mt-1 w-full rounded-md border border-border-ui bg-surface-card px-3 py-2 text-sm text-text-pri" placeholder={t('customerUpdateMessagePlaceholder')} />
                  </>
                ) : (
                  <p className="mt-3 rounded-md bg-info/10 px-3 py-2 text-sm text-text-pri">{row.customer_message}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="submit" size="sm" variant={row.customer_visible ? 'secondary' : 'primary'} disabled={savingId === row.id}>
                    {savingId === row.id ? t('savingCustomerUpdate') : row.customer_visible ? t('hideCustomerUpdate') : t('shareCustomerUpdate')}
                  </Button>
                  {row.customer_visible && (
                    <Button type="button" size="sm" variant="secondary" disabled={savingId === row.id} onClick={() => {
                      const data = new FormData()
                      void save(row.id, data, true)
                    }}>
                      {t('resendCustomerUpdateEmail')}
                    </Button>
                  )}
                </div>
              </form>
            ))}
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        {notice && <p role="status" className="mt-3 text-sm text-text-sec">{notice}</p>}
        <p className="mt-3 text-text-mut text-xs">{t('customerExceptionPrivacy')}</p>
      </CardBody>
    </Card>
  )
}
