'use client'
// app/(admin)/admin/page.tsx — Triage Queue (audit gap #14, mockup-23's
// landing screen). Client-fetched from GET /api/admin/orgs (cross-tenant
// data an sx_* profile's own RLS-scoped session can't see directly — see
// lib/admin-auth.ts) rather than queried server-side, since the privileged
// aggregation already lives in that route.
//
// Urgency buckets are derived here from real fields (health_score,
// billing_status, trial_ends_at), not a separate `urgency_score` column —
// no such column/table exists (mockup-23's own severity spec is
// implemented as a client-side classification of data the orgs route
// already returns, not new schema).
//
// Uses components/ui/* (Card/KpiTile/StatusBadge/Button/EmptyState) and the
// canonical Triage pattern / severity color mapping from
// docs/design/carrieros-design-system.md §6.2/§6.3, rather than hand-rolled
// Tailwind — this page's own first draft got that wrong (raw hex borders,
// no component reuse); fixed per that doc's own recipe.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, KpiTile, StatusBadge, Button, EmptyState } from '@/components/ui'

interface Org {
  org_id: number
  name: string
  tier: string | null
  billing_status: string | null
  trial_ends_at: string | null
  grace_period_until: string | null
  last_active: string | null
  loads_this_month: number
  health_score: number
}

type Urgency = 'critical' | 'high' | 'medium' | 'low'

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
}

function urgencyOf(org: Org): Urgency {
  if (org.billing_status === 'past_due') return 'critical'
  const trialDays = daysUntil(org.trial_ends_at)
  if (org.billing_status === 'trialing' && trialDays !== null && trialDays <= 7) return 'high'
  if (org.health_score < 40) return 'high'
  if (org.health_score < 70) return 'medium'
  return 'low'
}

export default function TriageQueuePage() {
  const t = useTranslations('admin.triage')
  const [orgs, setOrgs] = useState<Org[] | null>(null)
  const [error, setError] = useState('')
  const [extending, setExtending] = useState<number | null>(null)

  // §6.2/§6.3: Critical → danger/border-l-danger, High → brand/border-l-brand-orange
  // (urgent-but-not-broken), Medium → warning/border-l-warning, Low → info/border-l-info.
  const URGENCY_STYLE: Record<Urgency, { border: string; label: string; badgeVariant: 'danger' | 'brand' | 'warning' | 'info' }> = {
    critical: { border: 'border-l-danger', label: t('urgencyCritical'), badgeVariant: 'danger' },
    high:     { border: 'border-l-brand-orange', label: t('urgencyHigh'), badgeVariant: 'brand' },
    medium:   { border: 'border-l-warning', label: t('urgencyMedium'), badgeVariant: 'warning' },
    low:      { border: 'border-l-info', label: t('urgencyLow'), badgeVariant: 'info' },
  }

  async function load() {
    try {
      const res = await fetch('/api/admin/orgs')
      if (!res.ok) throw new Error('Failed to load orgs')
      const json = await res.json()
      setOrgs(json.orgs)
    } catch {
      setError(t('error'))
    }
  }

  useEffect(() => {
    // Deferred a microtask so the initial fetch's state updates are not a
    // synchronous setState in the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function extendTrial(orgId: number) {
    setExtending(orgId)
    await fetch(`/api/admin/orgs/${orgId}/trial`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 7 }),
    })
    setExtending(null)
    load()
  }

  if (error) return <div className="p-8 text-danger text-sm">{error}</div>
  if (!orgs) return <div className="p-8 text-text-sec text-sm">{t('loading')}</div>

  const flagged = orgs
    .map((o) => ({ ...o, urgency: urgencyOf(o) }))
    .filter((o) => o.urgency !== 'low')
    .sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 } as const)[a.urgency] - ({ critical: 0, high: 1, medium: 2, low: 3 } as const)[b.urgency])

  const kpis = {
    total: orgs.length,
    pastDue: orgs.filter((o) => o.billing_status === 'past_due').length,
    trialsEndingSoon: orgs.filter((o) => o.billing_status === 'trialing' && (daysUntil(o.trial_ends_at) ?? 99) <= 7).length,
    atRisk: orgs.filter((o) => o.health_score < 40).length,
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-text-pri mb-1">{t('title')}</h1>
      <p className="text-text-sec text-sm mb-6">{t('subtitle')}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiTile label={t('kpiTotalOrgs')} value={kpis.total} />
        <KpiTile label={t('kpiPastDue')} value={kpis.pastDue} />
        <KpiTile label={t('kpiTrialsEnding')} value={kpis.trialsEndingSoon} />
        <KpiTile label={t('kpiAtRisk')} value={kpis.atRisk} />
      </div>

      {flagged.length === 0 ? (
        <Card>
          <EmptyState icon="check_circle" title={t('nothingNeedsAttention')} />
        </Card>
      ) : (
        <div className="space-y-2">
          {flagged.map((o) => {
            const style = URGENCY_STYLE[o.urgency]
            const trialDays = daysUntil(o.trial_ends_at)
            return (
              <Card key={o.org_id} className={`border-l-[3px] ${style.border} px-5 py-4 flex items-center justify-between gap-4`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/orgs/${o.org_id}`} className="text-text-pri font-medium hover:text-brand-orange transition-colors">
                      {o.name}
                    </Link>
                    <StatusBadge variant={style.badgeVariant} size="sm">{style.label}</StatusBadge>
                  </div>
                  <p className="text-text-mut text-xs mt-0.5">
                    {o.tier ?? '—'} · health {o.health_score} · {o.billing_status ?? '—'}
                    {o.billing_status === 'trialing' && trialDays !== null && t('trialEndsIn', { days: trialDays })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {o.billing_status === 'trialing' && (
                    <Button variant="secondary" size="sm" onClick={() => extendTrial(o.org_id)} loading={extending === o.org_id}>
                      {t('extendTrial')}
                    </Button>
                  )}
                  <Link
                    href={`/admin/orgs/${o.org_id}`}
                    className="inline-flex items-center justify-center rounded-md font-semibold transition-colors px-2 py-1 text-[11px] bg-brand-orange text-white hover:bg-brand-orange/90"
                  >
                    {t('view')}
                  </Link>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
