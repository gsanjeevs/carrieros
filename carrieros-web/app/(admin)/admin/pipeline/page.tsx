'use client'
// app/(admin)/admin/pipeline/page.tsx — Sales Pipeline (audit gap #14).
// GET /api/admin/pipeline — see that route's own header comment: no
// `sales_pipeline` table exists, so this is computed directly from
// carrier_details/loads/drivers, not a dedicated pipeline data model.
import { useEffect, useState } from 'react'
import Link from 'next/link'

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

  if (error) return <div className="p-8 text-red-400 text-sm">{error}</div>
  if (!trialing || !candidates) return <div className="p-8 text-slate-400 text-sm">Loading…</div>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white mb-1">Sales Pipeline</h1>
      <p className="text-slate-400 text-sm mb-6">Trials ending soon, and Starter orgs that look ready to upgrade.</p>

      <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark mb-6">
        <div className="px-5 py-3.5 border-b border-white/5">
          <h2 className="text-white font-medium text-sm">Trials ({trialing.length})</h2>
        </div>
        {trialing.length === 0 ? (
          <div className="px-5 py-8 text-center text-slate-500 text-sm">No orgs currently trialing.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {trialing.map((o) => {
              const days = daysLeft(o.trial_ends_at)
              return (
                <div key={o.org_id} className="flex items-center justify-between px-5 py-3">
                  <Link href={`/admin/orgs/${o.org_id}`} className="text-white text-sm font-medium hover:text-[#f97316] transition-colors">
                    {o.org_name}
                  </Link>
                  <span className={`text-xs ${days !== null && days <= 7 ? 'text-amber-400' : 'text-slate-400'}`}>
                    {days !== null ? `${days}d left` : '—'}
                  </span>
                  <button
                    onClick={() => extendTrial(o.org_id)}
                    disabled={extending === o.org_id}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition"
                  >
                    {extending === o.org_id ? 'Extending…' : 'Extend +7d'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
        <div className="px-5 py-3.5 border-b border-white/5">
          <h2 className="text-white font-medium text-sm">Upgrade Candidates ({candidates.length})</h2>
          <p className="text-slate-500 text-xs mt-0.5">Starter orgs with ≥8 loads in 30 days or more than one active driver.</p>
        </div>
        {candidates.length === 0 ? (
          <div className="px-5 py-8 text-center text-slate-500 text-sm">No Starter orgs currently look ready to upgrade.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {candidates.map((c) => (
              <Link key={c.org_id} href={`/admin/orgs/${c.org_id}`} className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.07] transition-colors">
                <span className="text-white text-sm font-medium">{c.org_name}</span>
                <span className="text-slate-400 text-xs">{c.loads_last_30d} loads/30d</span>
                <span className="text-slate-400 text-xs">{c.active_drivers} drivers</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
