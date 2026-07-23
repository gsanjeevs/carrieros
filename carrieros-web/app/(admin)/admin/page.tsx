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
import { useEffect, useState } from 'react'
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

const URGENCY_STYLE: Record<Urgency, { border: string; label: string; badge: string }> = {
  critical: { border: 'border-l-red-500', label: 'Critical', badge: 'bg-red-500/15 text-red-400' },
  high:     { border: 'border-l-orange-500', label: 'High', badge: 'bg-orange-500/15 text-orange-400' },
  medium:   { border: 'border-l-amber-500', label: 'Medium', badge: 'bg-amber-500/15 text-amber-400' },
  low:      { border: 'border-l-blue-500', label: 'Low', badge: 'bg-blue-500/15 text-blue-400' },
}

export default function TriageQueuePage() {
  const [orgs, setOrgs] = useState<Org[] | null>(null)
  const [error, setError] = useState('')
  const [extending, setExtending] = useState<number | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/admin/orgs')
      if (!res.ok) throw new Error('Failed to load orgs')
      const json = await res.json()
      setOrgs(json.orgs)
    } catch {
      setError('Could not load organizations.')
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

  if (error) return <div className="p-8 text-red-400 text-sm">{error}</div>
  if (!orgs) return <div className="p-8 text-slate-400 text-sm">Loading…</div>

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
      <h1 className="text-2xl font-semibold text-white mb-1">Triage Queue</h1>
      <p className="text-slate-400 text-sm mb-6">Organizations needing attention, most urgent first.</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Orgs', value: kpis.total },
          { label: 'Past Due', value: kpis.pastDue },
          { label: 'Trials Ending ≤7d', value: kpis.trialsEndingSoon },
          { label: 'At Risk (health<40)', value: kpis.atRisk },
        ].map((k) => (
          <div key={k.label} className="bg-white/5 border border-white/8 rounded-xl p-4 shadow-card-dark">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{k.label}</p>
            <p className="text-2xl font-semibold text-white">{k.value}</p>
          </div>
        ))}
      </div>

      {flagged.length === 0 ? (
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center shadow-card-dark">
          <span className="material-symbols-outlined text-slate-600 text-4xl">check_circle</span>
          <p className="text-slate-400 text-sm mt-3">Nothing needs attention right now.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {flagged.map((o) => {
            const style = URGENCY_STYLE[o.urgency]
            const trialDays = daysUntil(o.trial_ends_at)
            return (
              <div key={o.org_id} className={`bg-white/5 border border-white/8 border-l-[3px] ${style.border} rounded-xl px-5 py-4 shadow-card-dark flex items-center justify-between gap-4`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/orgs/${o.org_id}`} className="text-white font-medium hover:text-[#f97316] transition-colors">
                      {o.name}
                    </Link>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${style.badge}`}>{style.label}</span>
                  </div>
                  <p className="text-slate-500 text-xs mt-0.5">
                    {o.tier ?? '—'} · health {o.health_score} · {o.billing_status ?? '—'}
                    {o.billing_status === 'trialing' && trialDays !== null && ` · trial ends in ${trialDays}d`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {o.billing_status === 'trialing' && (
                    <button
                      onClick={() => extendTrial(o.org_id)}
                      disabled={extending === o.org_id}
                      className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition"
                    >
                      {extending === o.org_id ? 'Extending…' : 'Extend Trial +7d'}
                    </button>
                  )}
                  <Link href={`/admin/orgs/${o.org_id}`} className="px-3 py-1.5 bg-[#f97316]/10 hover:bg-[#f97316]/20 text-[#f97316] text-xs font-semibold rounded-lg transition">
                    View
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
