'use client'
// app/(admin)/admin/billing/page.tsx — Billing & Payments (audit gap
// #14). GET /api/admin/billing — see that route's own header comment for
// why billing_events will show empty (no real Stripe webhooks wired).
import { useEffect, useState } from 'react'
import Link from 'next/link'

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
      .catch(() => setError('Could not load billing data.'))
  }, [])

  if (error) return <div className="p-8 text-red-400 text-sm">{error}</div>
  if (!atRisk || !events) return <div className="p-8 text-slate-400 text-sm">Loading…</div>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white mb-1">Billing &amp; Payments</h1>
      <p className="text-slate-400 text-sm mb-6">Orgs past due or in a grace period, and recent billing events.</p>

      <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark mb-6">
        <div className="px-5 py-3.5 border-b border-white/5">
          <h2 className="text-white font-medium text-sm">At Risk ({atRisk.length})</h2>
        </div>
        {atRisk.length === 0 ? (
          <div className="px-5 py-8 text-center text-slate-500 text-sm">No orgs are past due or in a grace period.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {atRisk.map((o) => (
              <Link key={o.org_id} href={`/admin/orgs/${o.org_id}`} className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.07] transition-colors">
                <span className="text-white text-sm font-medium">{o.org_name}</span>
                <span className="text-slate-400 text-xs capitalize">{o.billing_status}</span>
                <span className="text-slate-500 text-xs">
                  {o.card_brand ? `${o.card_brand} •••• ${o.card_last4}` : 'No card on file'}
                </span>
                <span className="text-slate-400 text-xs">
                  {o.grace_period_until ? `Grace until ${new Date(o.grace_period_until).toLocaleDateString()}` : '—'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
        <div className="px-5 py-3.5 border-b border-white/5">
          <h2 className="text-white font-medium text-sm">Recent Billing Events</h2>
        </div>
        {events.length === 0 ? (
          <div className="px-5 py-8 text-center text-slate-500 text-sm">
            No billing events yet — real Stripe webhooks aren&apos;t configured in this environment.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {events.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-white">{e.org_name}</span>
                <span className="text-slate-400">{e.event_type}</span>
                <span className="text-slate-300">{e.amount != null ? `$${e.amount.toLocaleString()}` : '—'}</span>
                <span className="text-slate-500 text-xs">{new Date(e.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
