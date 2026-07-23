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
      setError('Could not load pipeline data.')
    }
  }

  useEffect(() => {
    load()
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
  if (!trialing || !candidates) return <div className="p-8 text-text-sec text-sm">Loading…</div>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-text-pri mb-1">Sales Pipeline</h1>
      <p className="text-text-sec text-sm mb-6">Trials ending soon, and Starter orgs that look ready to upgrade.</p>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-text-pri font-medium text-sm">Trials ({trialing.length})</h2>
        </CardHeader>
        {trialing.length === 0 ? (
          <EmptyState icon="trending_up" title="No orgs currently trialing." />
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
                    <StatusBadge variant="warning" size="sm">{days}d left</StatusBadge>
                  ) : (
                    <span className="text-text-sec text-xs">{days !== null ? `${days}d left` : '—'}</span>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => extendTrial(o.org_id)} loading={extending === o.org_id}>
                    Extend +7d
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
            <h2 className="text-text-pri font-medium text-sm">Upgrade Candidates ({candidates.length})</h2>
            <p className="text-text-mut text-xs mt-0.5">Starter orgs with ≥8 loads in 30 days or more than one active driver.</p>
          </div>
        </CardHeader>
        {candidates.length === 0 ? (
          <EmptyState icon="trending_up" title="No Starter orgs currently look ready to upgrade." />
        ) : (
          <div className="divide-y divide-divider-ui">
            {candidates.map((c) => (
              <Link key={c.org_id} href={`/admin/orgs/${c.org_id}`} className="flex items-center justify-between px-5 py-3 hover:bg-surface-subtle transition-colors">
                <span className="text-text-pri text-sm font-medium">{c.org_name}</span>
                <span className="text-text-sec text-xs">{c.loads_last_30d} loads/30d</span>
                <span className="text-text-sec text-xs">{c.active_drivers} drivers</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
