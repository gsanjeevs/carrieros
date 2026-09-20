'use client'
// app/(admin)/admin/billing/page.tsx — Billing & Payments (audit gap
// #14). GET /api/admin/billing — see that route's own header comment for
// why billing_events will show empty (no real Stripe webhooks wired).
//
// Uses components/ui/* (Card/CardHeader/EmptyState) per docs/design/
// carrieros-design-system.md §5 rather than hand-rolled Tailwind.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardHeader, EmptyState } from '@/components/ui'

interface AtRiskOrg {
  org_id: number
  org_name: string | null
  billing_status: string | null
  grace_period_until: string | null
  card_brand: string | null
  card_last4: string | null
}

interface BillingEvent {
  id: number
  org_id: number
  org_name: string | null
  event_type: string
  amount: number | null
  status: string | null
  created_at: string
}

export default function BillingPage() {
  const t = useTranslations('admin.billing')
  const [atRisk, setAtRisk] = useState<AtRiskOrg[] | null>(null)
  const [events, setEvents] = useState<BillingEvent[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/admin/billing')
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((json) => {
        setAtRisk(json.at_risk_orgs)
        setEvents(json.events)
      })
      .catch(() => setError(t('error')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <div className="p-8 text-danger text-sm">{error}</div>
  if (!atRisk || !events) return <div className="p-8 text-text-sec text-sm">{t('loading')}</div>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-text-pri mb-1">{t('title')}</h1>
      <p className="text-text-sec text-sm mb-6">{t('subtitle')}</p>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-text-pri font-medium text-sm">{t('atRisk', { count: atRisk.length })}</h2>
        </CardHeader>
        {atRisk.length === 0 ? (
          <EmptyState icon="check_circle" title={t('noAtRisk')} />
        ) : (
          <div className="divide-y divide-divider-ui">
            {atRisk.map((o) => (
              <Link key={o.org_id} href={`/admin/orgs/${o.org_id}`} className="flex items-center justify-between px-5 py-3 hover:bg-surface-subtle transition-colors">
                <span className="text-text-pri text-sm font-medium">{o.org_name}</span>
                <span className="text-text-sec text-xs capitalize">{o.billing_status}</span>
                <span className="text-text-mut text-xs">
                  {o.card_brand ? `${o.card_brand} •••• ${o.card_last4}` : t('noCardOnFile')}
                </span>
                <span className="text-text-sec text-xs">
                  {o.grace_period_until ? t('graceUntil', { date: new Date(o.grace_period_until).toLocaleDateString() }) : '—'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-text-pri font-medium text-sm">{t('recentEvents')}</h2>
        </CardHeader>
        {events.length === 0 ? (
          <EmptyState
            icon="receipt_long"
            title={t('noEventsTitle')}
            description={t('noEventsDescription')}
          />
        ) : (
          <div className="divide-y divide-divider-ui">
            {events.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-text-pri">{e.org_name}</span>
                <span className="text-text-sec">{e.event_type}</span>
                <span className="text-text-pri">{e.amount != null ? `$${e.amount.toLocaleString()}` : '—'}</span>
                <span className="text-text-mut text-xs">{new Date(e.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
