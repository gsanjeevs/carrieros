'use client'
// app/(admin)/admin/health/page.tsx — Customer Health Board (audit gap
// #14). GET /api/admin/orgs already returns health_score sorted worst-
// first, exactly matching mockup-23's default sort — this page is a thin
// table + filter chips over that response.
//
// Uses components/ui/* (Card/Table/ProgressBar) per docs/design/
// carrieros-design-system.md §5 rather than hand-rolled Tailwind.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, Table, TableHeaderCell, TableRow, TableCell, ProgressBar } from '@/components/ui'

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

function healthVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 70) return 'success'
  if (score >= 40) return 'warning'
  return 'danger'
}

const TIER_FILTERS = ['all', 'starter', 'growth', 'pro', 'enterprise'] as const

export default function CustomerHealthPage() {
  const [orgs, setOrgs] = useState<Org[] | null>(null)
  const [error, setError] = useState('')
  const [tierFilter, setTierFilter] = useState<(typeof TIER_FILTERS)[number]>('all')

  useEffect(() => {
    fetch('/api/admin/orgs')
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((json) => setOrgs(json.orgs))
      .catch(() => setError('Could not load organizations.'))
  }, [])

  const filtered = useMemo(() => {
    if (!orgs) return []
    if (tierFilter === 'all') return orgs
    return orgs.filter((o) => o.tier === tierFilter)
  }, [orgs, tierFilter])

  if (error) return <div className="p-8 text-danger text-sm">{error}</div>
  if (!orgs) return <div className="p-8 text-text-sec text-sm">Loading…</div>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-text-pri mb-1">Customer Health</h1>
      <p className="text-text-sec text-sm mb-6">{orgs.length} organizations, sorted worst-health-first.</p>

      <div className="flex items-center gap-2 mb-4">
        {TIER_FILTERS.map((t) => (
          <button
            key={t}
            onClick={() => setTierFilter(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
              tierFilter === t ? 'bg-brand-orange text-white' : 'bg-surface-subtle text-text-sec hover:bg-surface-subtle/70'
            }`}
          >
            {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <Card>
        <Table>
          <thead>
            <tr>
              <TableHeaderCell>Org</TableHeaderCell>
              <TableHeaderCell>Tier</TableHeaderCell>
              <TableHeaderCell>Billing</TableHeaderCell>
              <TableHeaderCell numeric>Loads/30d</TableHeaderCell>
              <TableHeaderCell>Health</TableHeaderCell>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <TableRow key={o.org_id}>
                <TableCell>
                  <Link href={`/admin/orgs/${o.org_id}`} className="text-text-pri font-medium hover:text-brand-orange transition-colors">
                    {o.name}
                  </Link>
                </TableCell>
                <TableCell className="capitalize">{o.tier ?? '—'}</TableCell>
                <TableCell className="capitalize">{o.billing_status ?? '—'}</TableCell>
                <TableCell numeric>{o.loads_this_month}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="w-16">
                      <ProgressBar value={o.health_score} variant={healthVariant(o.health_score)} thin label={`Health score ${o.health_score}`} />
                    </div>
                    <span className="text-text-sec text-xs w-6">{o.health_score}</span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
