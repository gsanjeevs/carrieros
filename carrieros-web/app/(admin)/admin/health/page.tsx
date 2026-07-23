'use client'
// app/(admin)/admin/health/page.tsx — Customer Health Board (audit gap
// #14). GET /api/admin/orgs already returns health_score sorted worst-
// first, exactly matching mockup-23's default sort — this page is a thin
// table + filter chips over that response.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

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

function healthColor(score: number): string {
  if (score >= 70) return 'bg-[#16a34a]'
  if (score >= 40) return 'bg-amber-500'
  return 'bg-red-500'
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

  if (error) return <div className="p-8 text-red-400 text-sm">{error}</div>
  if (!orgs) return <div className="p-8 text-slate-400 text-sm">Loading…</div>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white mb-1">Customer Health</h1>
      <p className="text-slate-400 text-sm mb-6">{orgs.length} organizations, sorted worst-health-first.</p>

      <div className="flex items-center gap-2 mb-4">
        {TIER_FILTERS.map((t) => (
          <button
            key={t}
            onClick={() => setTierFilter(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
              tierFilter === t ? 'bg-[#f97316] text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Org</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Tier</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Billing</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Loads/30d</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Health</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filtered.map((o) => (
              <tr key={o.org_id} className="hover:bg-white/[0.07] transition-colors duration-150">
                <td className="px-5 py-3">
                  <Link href={`/admin/orgs/${o.org_id}`} className="text-white font-medium hover:text-[#f97316] transition-colors">
                    {o.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-300 capitalize">{o.tier ?? '—'}</td>
                <td className="px-4 py-3 text-slate-400 capitalize">{o.billing_status ?? '—'}</td>
                <td className="px-4 py-3 text-right text-slate-300">{o.loads_this_month}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className={`h-full rounded-full ${healthColor(o.health_score)}`} style={{ width: `${o.health_score}%` }} />
                    </div>
                    <span className="text-slate-300 text-xs w-6">{o.health_score}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
