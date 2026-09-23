'use client'
// app/(app)/support/page.tsx — in-app support ticketing entry point (decisions.md T16). ANY
// authenticated user, any role, any tier can submit here (nav gated on 'settings_view', same "every
// tenant role has this" reasoning components/Sidebar.tsx already uses for /settings itself).
//
// Intake is a category picker + body field + one conditional field (T16's own explicit guidance: not
// a dynamic form builder for a first build). Identity/context (role, org, tier) is captured
// automatically server-side (app/api/support/tickets/route.ts) — never asked here.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardBody, Button, Input, StatusBadge } from '@/components/ui'

type Category = 'technical_issue' | 'load_dispatch' | 'account_billing' | 'compliance_safety' | 'driver_pay_hr' | 'feature_request' | 'other'

interface Ticket {
  id: number
  category: string
  body: string
  queue: 'carrieros_support' | 'org_support' | 'ai_resolved'
  status: 'open' | 'resolved' | 'closed'
  created_at: string
}

const CATEGORIES: Category[] = ['technical_issue', 'load_dispatch', 'account_billing', 'compliance_safety', 'driver_pay_hr', 'feature_request', 'other']

export default function SupportPage() {
  const t = useTranslations('support')
  const tErrors = useTranslations('errors')

  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [category, setCategory] = useState<Category>('technical_issue')
  const [body, setBody] = useState('')
  const [relatedLoadNumber, setRelatedLoadNumber] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const res = await fetch('/api/support/tickets')
    if (res.ok) setTickets((await res.json()).tickets)
  }

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [])

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  async function submit() {
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          body,
          related_load_number: category === 'load_dispatch' && relatedLoadNumber ? relatedLoadNumber : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))
      setBody('')
      setRelatedLoadNumber('')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : friendly('SERVER_ERROR'))
    } finally {
      setSubmitting(false)
    }
  }

  const QUEUE_LABEL: Record<Ticket['queue'], string> = {
    ai_resolved: t('queueAiResolved'),
    carrieros_support: t('queueCarrierosSupport'),
    org_support: t('queueOrgSupport'),
  }
  const STATUS_VARIANT: Record<Ticket['status'], 'warning' | 'success' | 'neutral'> = {
    open: 'warning', resolved: 'success', closed: 'neutral',
  }
  const STATUS_LABEL: Record<Ticket['status'], string> = {
    open: t('statusOpen'), resolved: t('statusResolved'), closed: t('statusClosed'),
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h1 className="text-text-pri text-xl font-semibold mb-1">{t('title')}</h1>
      <p className="text-text-sec text-sm mb-8">{t('subtitle')}</p>

      <Card className="mb-8">
        <CardBody>
          <h2 className="text-text-pri font-medium text-sm mb-4">{t('newTicket')}</h2>

          {error && <p className="text-danger text-sm mb-3">{error}</p>}

          <label className="block text-xs font-medium text-text-sec mb-1.5">{t('categoryLabel')}</label>
          <Input as="select" value={category} onChange={(e) => setCategory(e.target.value as Category)} className="mb-4">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{t(`categories.${c}`)}</option>
            ))}
          </Input>

          {category === 'load_dispatch' && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-text-sec mb-1.5">{t('relatedLoadLabel')}</label>
              <Input value={relatedLoadNumber} onChange={(e) => setRelatedLoadNumber(e.target.value)} placeholder="LD-0001" />
            </div>
          )}

          <label className="block text-xs font-medium text-text-sec mb-1.5">{t('bodyLabel')}</label>
          <Input
            as="textarea"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('bodyPlaceholder')}
            className="resize-none mb-4"
          />

          <Button onClick={submit} disabled={body.trim().length < 10} loading={submitting}>
            {t('submit')}
          </Button>
        </CardBody>
      </Card>

      <h2 className="text-text-pri font-medium text-sm mb-3">{t('myTickets')}</h2>
      {tickets === null ? (
        <p className="text-text-sec text-sm">{t('loading')}</p>
      ) : tickets.length === 0 ? (
        <p className="text-text-mut text-sm">{t('noTickets')}</p>
      ) : (
        <div className="space-y-2">
          {tickets.map((tk) => (
            <Link key={tk.id} href={`/support/${tk.id}`}>
              <Card variant="interactive" className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-text-pri text-sm truncate">{t(`categories.${tk.category}`)} — {QUEUE_LABEL[tk.queue]}</p>
                  <p className="text-text-mut text-xs truncate">{tk.body}</p>
                </div>
                <StatusBadge variant={STATUS_VARIANT[tk.status]} size="sm">{STATUS_LABEL[tk.status]}</StatusBadge>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
