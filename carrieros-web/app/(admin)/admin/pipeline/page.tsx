'use client'
// app/(admin)/admin/pipeline/page.tsx — Sales Pipeline (audit gap #14).
// GET /api/admin/pipeline — see that route's own header comment: no
// `sales_pipeline` table exists, so this is computed directly from
// carrier_details/loads/drivers, not a dedicated pipeline data model.
//
// Uses components/ui/* (Card/CardHeader/Button/StatusBadge/EmptyState) per
// docs/design/carrieros-design-system.md §5 rather than hand-rolled Tailwind.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardHeader, Button, StatusBadge, EmptyState } from '@/components/ui'

interface TrialOrg {
  org_id: number
  org_name: string | null
  trial_ends_at: string | null
}

interface UpgradeCandidate {
  org_id: number
  org_name: string | null
  loads_last_30d: number
  active_drivers: number
}

function daysLeft(dateStr: string | null): number | null {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
}

export default function PipelinePage() {
  const t = useTranslations('admin.pipeline')
  const [trialing, setTrialing] = useState<TrialOrg[] | null>(null)
  const [candidates, setCandidates] = useState<UpgradeCandidate[] | null>(null)
  const [error, setError] = useState('')
  const [extending, setExtending] = useState<number | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/admin/pipeline')
      if (!res.ok) throw new Error()
      const json = await res.json()
      setTrialing(json.trialing)
      setCandidates(json.upgrade_candidates)
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
  if (!trialing || !candidates) return <div className="p-8 text-text-sec text-sm">{t('loading')}</div>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-text-pri mb-1">{t('title')}</h1>
      <p className="text-text-sec text-sm mb-6">{t('subtitle')}</p>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-text-pri font-medium text-sm">{t('trials', { count: trialing.length })}</h2>
        </CardHeader>
        {trialing.length === 0 ? (
          <EmptyState icon="trending_up" title={t('noTrials')} />
        ) : (
          <div className="divide-y divide-divider-ui">
            {trialing.map((o) => {
              const days = daysLeft(o.trial_ends_at)
              return (
                <div key={o.org_id} className="flex items-center justify-between px-5 py-3">
                  <Link href={`/admin/orgs/${o.org_id}`} className="text-text-pri text-sm font-medium hover:text-brand-orange transition-colors">
                    {o.org_name}
                  </Link>
                  {days !== null && days <= 7 ? (
                    <StatusBadge variant="warning" size="sm">{t('daysLeft', { days })}</StatusBadge>
                  ) : (
                    <span className="text-text-sec text-xs">{days !== null ? t('daysLeft', { days }) : '—'}</span>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => extendTrial(o.org_id)} loading={extending === o.org_id}>
                    {t('extend')}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div>
            <h2 className="text-text-pri font-medium text-sm">{t('upgradeCandidates', { count: candidates.length })}</h2>
            <p className="text-text-mut text-xs mt-0.5">{t('upgradeCandidatesDesc')}</p>
          </div>
        </CardHeader>
        {candidates.length === 0 ? (
          <EmptyState icon="trending_up" title={t('noCandidates')} />
        ) : (
          <div className="divide-y divide-divider-ui">
            {candidates.map((c) => (
              <Link key={c.org_id} href={`/admin/orgs/${c.org_id}`} className="flex items-center justify-between px-5 py-3 hover:bg-surface-subtle transition-colors">
                <span className="text-text-pri text-sm font-medium">{c.org_name}</span>
                <span className="text-text-sec text-xs">{t('loadsPer30d', { count: c.loads_last_30d })}</span>
                <span className="text-text-sec text-xs">{t('drivers', { count: c.active_drivers })}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
