'use client'
// app/(admin)/admin/orgs/[org_id]/page.tsx — Org Detail (audit gap #14).
// Client-fetched from GET /api/admin/orgs/[org_id] (KPIs, adoption
// checklist, users, recent loads, notes) plus the notes/tier/trial/
// grace-period/impersonate action routes, all of which already existed
// except trial and grace-period (added this pass).
import { useEffect, useState, use as usePromise } from 'react'
import Link from 'next/link'

interface OrgDetail {
  org: { id: number; name: string; created_at: string }
  carrier_details: {
    tier: string | null
    billing_status: string | null
    trial_ends_at: string | null
    grace_period_until: string | null
    mc_number: string | null
    dot_number: string | null
  } | null
  kpis: { loads_this_month: number; uninvoiced_revenue: number; last_active: string | null }
  adoption: Record<string, boolean>
  users: { id: string; name: string | null; role: string; email: string | null; last_sign_in_at: string | null }[]
  recent_loads: { id: number; status: string | null; rate: number | null; created_at: string }[]
  notes: { id: number; body: string; admin_id: string | null; created_at: string }[]
}

const TIERS = ['starter', 'growth', 'pro', 'enterprise']
const ADOPTION_LABELS: Record<string, string> = {
  completed_onboarding: 'Completed onboarding',
  added_first_vehicle: 'Added first vehicle',
  added_first_driver: 'Added first driver',
  created_first_load: 'Created first load',
  dispatched_load: 'Dispatched a load',
  sent_first_invoice: 'Sent first invoice',
  received_first_payment: 'Received first payment',
}

export default function OrgDetailPage({ params }: { params: Promise<{ org_id: string }> }) {
  const { org_id } = usePromise(params)

  const [data, setData] = useState<OrgDetail | null>(null)
  const [error, setError] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [savingTier, setSavingTier] = useState(false)
  const [impersonateLink, setImpersonateLink] = useState('')
  const [busyAction, setBusyAction] = useState('')

  async function load() {
    try {
      const res = await fetch(`/api/admin/orgs/${org_id}`)
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch {
      setError('Could not load this organization.')
    }
  }

  useEffect(() => {
    load()
  }, [org_id])

  async function addNote() {
    if (!noteDraft.trim()) return
    setSavingNote(true)
    await fetch(`/api/admin/orgs/${org_id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: noteDraft.trim() }),
    })
    setNoteDraft('')
    setSavingNote(false)
    load()
  }

  async function changeTier(tier: string) {
    setSavingTier(true)
    await fetch(`/api/admin/orgs/${org_id}/tier`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    })
    setSavingTier(false)
    load()
  }

  async function impersonate() {
    setBusyAction('impersonate')
    const res = await fetch(`/api/admin/orgs/${org_id}/impersonate`, { method: 'POST' })
    setBusyAction('')
    if (res.ok) {
      const json = await res.json()
      setImpersonateLink(json.magic_link)
    }
  }

  async function extendTrial() {
    setBusyAction('trial')
    await fetch(`/api/admin/orgs/${org_id}/trial`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 7 }),
    })
    setBusyAction('')
    load()
  }

  async function setGracePeriod(days: number | null) {
    setBusyAction('grace')
    await fetch(`/api/admin/orgs/${org_id}/grace-period`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days }),
    })
    setBusyAction('')
    load()
  }

  if (error) return <div className="p-8 text-red-400 text-sm">{error}</div>
  if (!data) return <div className="p-8 text-slate-400 text-sm">Loading…</div>

  const cd = data.carrier_details
  const cardCls = 'bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark'

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/admin/health" className="text-slate-400 text-sm hover:text-white flex items-center gap-1.5 mb-4">
        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        Back to Customer Health
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">{data.org.name}</h1>
          <p className="text-slate-400 text-sm mt-1">
            {cd?.tier ?? '—'} · {cd?.billing_status ?? '—'}
            {cd?.trial_ends_at && ` · trial ends ${new Date(cd.trial_ends_at).toLocaleDateString()}`}
          </p>
        </div>
        <button
          onClick={impersonate}
          disabled={busyAction === 'impersonate'}
          className="px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition"
        >
          {busyAction === 'impersonate' ? 'Generating…' : 'Impersonate Owner'}
        </button>
      </div>

      {impersonateLink && (
        <div className="mb-6 rounded-lg bg-[#f97316]/10 border border-[#f97316]/20 px-4 py-3">
          <p className="text-[#f97316] text-xs mb-1">Magic link (single use):</p>
          <code className="text-slate-300 text-xs break-all">{impersonateLink}</code>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className={cardCls}>
            <h2 className="text-white font-medium text-sm mb-3">KPIs</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Loads / 30d</p>
                <p className="text-xl font-semibold text-white">{data.kpis.loads_this_month}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Uninvoiced Revenue</p>
                <p className="text-xl font-semibold text-white">${data.kpis.uninvoiced_revenue.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Last Active</p>
                <p className="text-sm text-slate-300 mt-1.5">{data.kpis.last_active ? new Date(data.kpis.last_active).toLocaleDateString() : 'Never'}</p>
              </div>
            </div>
          </div>

          <div className={cardCls}>
            <h2 className="text-white font-medium text-sm mb-3">Adoption</h2>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(data.adoption).map(([key, done]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className={`material-symbols-outlined text-[18px] ${done ? 'text-[#16a34a]' : 'text-slate-600'}`}>
                    {done ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <span className={`text-sm ${done ? 'text-slate-300' : 'text-slate-500'}`}>{ADOPTION_LABELS[key] ?? key}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={cardCls}>
            <h2 className="text-white font-medium text-sm mb-3">Users ({data.users.length})</h2>
            <div className="divide-y divide-white/5">
              {data.users.map((u) => (
                <div key={u.id} className="py-2 flex items-center justify-between text-sm">
                  <span className="text-white">{u.name ?? u.email ?? u.id}</span>
                  <span className="text-slate-500 text-xs capitalize">{u.role}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={cardCls}>
            <h2 className="text-white font-medium text-sm mb-3">Recent Loads</h2>
            {data.recent_loads.length === 0 ? (
              <p className="text-slate-500 text-sm">No loads yet.</p>
            ) : (
              <div className="divide-y divide-white/5">
                {data.recent_loads.slice(0, 10).map((l) => (
                  <div key={l.id} className="py-2 flex items-center justify-between text-sm">
                    <span className="text-slate-300 capitalize">{l.status ?? '—'}</span>
                    <span className="text-white">${(l.rate ?? 0).toLocaleString()}</span>
                    <span className="text-slate-500 text-xs">{new Date(l.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className={cardCls}>
            <h2 className="text-white font-medium text-sm mb-3">Tier</h2>
            <select
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
              value={cd?.tier ?? ''}
              onChange={(e) => changeTier(e.target.value)}
              disabled={savingTier}
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>

          <div className={cardCls}>
            <h2 className="text-white font-medium text-sm mb-3">Trial &amp; Grace Period</h2>
            <button
              onClick={extendTrial}
              disabled={busyAction === 'trial'}
              className="w-full mb-2 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition"
            >
              {busyAction === 'trial' ? 'Extending…' : 'Extend Trial +7 days'}
            </button>
            <p className="text-slate-500 text-xs mb-2">
              Grace period: {cd?.grace_period_until ? new Date(cd.grace_period_until).toLocaleDateString() : 'None'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setGracePeriod(7)}
                disabled={busyAction === 'grace'}
                className="flex-1 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition"
              >
                Set 7d
              </button>
              <button
                onClick={() => setGracePeriod(null)}
                disabled={busyAction === 'grace'}
                className="flex-1 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition"
              >
                Clear
              </button>
            </div>
          </div>

          <div className={cardCls}>
            <h2 className="text-white font-medium text-sm mb-3">Notes</h2>
            <div className="space-y-2 mb-3 max-h-60 overflow-y-auto">
              {data.notes.length === 0 ? (
                <p className="text-slate-500 text-sm">No notes yet.</p>
              ) : (
                data.notes.map((n) => (
                  <div key={n.id} className="bg-white/5 rounded-lg px-3 py-2">
                    <p className="text-slate-300 text-sm">{n.body}</p>
                    <p className="text-slate-500 text-[10px] mt-1">{new Date(n.created_at).toLocaleString()}</p>
                  </div>
                ))
              )}
            </div>
            <textarea
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm resize-none mb-2"
              rows={2}
              placeholder="Add a note…"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
            />
            <button
              onClick={addNote}
              disabled={savingNote || !noteDraft.trim()}
              className="w-full py-2 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition"
            >
              {savingNote ? 'Saving…' : 'Add Note'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
