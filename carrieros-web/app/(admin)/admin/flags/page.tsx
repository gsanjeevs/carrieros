'use client'
// app/(admin)/admin/flags/page.tsx — Feature Flags (audit gap #14).
// platform_flags/org_flag_overrides had schema + RLS but no UI or API
// route until this pass (GET/PATCH /api/admin/flags, POST .../override).
// Global default toggle is sx_owner only (matches RLS); per-org override
// creation reuses the same org list from /api/admin/orgs for the picker.
import { useEffect, useState } from 'react'

interface Flag {
  flag_key: string
  description: string
  default_enabled: boolean
}

interface Override {
  org_id: number
  org_name: string | null
  flag_key: string
  enabled: boolean
  set_at: string
}

interface OrgOption {
  org_id: number
  name: string
}

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<Flag[] | null>(null)
  const [overrides, setOverrides] = useState<Override[] | null>(null)
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [error, setError] = useState('')
  const [toggling, setToggling] = useState<string | null>(null)

  const [overrideOrgId, setOverrideOrgId] = useState('')
  const [overrideFlagKey, setOverrideFlagKey] = useState('')
  const [overrideEnabled, setOverrideEnabled] = useState(true)
  const [savingOverride, setSavingOverride] = useState(false)

  async function load() {
    try {
      const [flagsRes, orgsRes] = await Promise.all([
        fetch('/api/admin/flags'),
        fetch('/api/admin/orgs'),
      ])
      if (!flagsRes.ok) throw new Error()
      const flagsJson = await flagsRes.json()
      setFlags(flagsJson.flags)
      setOverrides(flagsJson.overrides)
      if (orgsRes.ok) {
        const orgsJson = await orgsRes.json()
        setOrgs(orgsJson.orgs.map((o: { org_id: number; name: string }) => ({ org_id: o.org_id, name: o.name })))
      }
    } catch {
      setError('Could not load feature flags.')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function toggleDefault(flagKey: string, current: boolean) {
    setToggling(flagKey)
    await fetch('/api/admin/flags', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flag_key: flagKey, default_enabled: !current }),
    })
    setToggling(null)
    load()
  }

  async function addOverride() {
    if (!overrideOrgId || !overrideFlagKey) return
    setSavingOverride(true)
    await fetch('/api/admin/flags/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: Number(overrideOrgId), flag_key: overrideFlagKey, enabled: overrideEnabled }),
    })
    setSavingOverride(false)
    setOverrideOrgId('')
    setOverrideFlagKey('')
    load()
  }

  if (error) return <div className="p-8 text-red-400 text-sm">{error}</div>
  if (!flags || !overrides) return <div className="p-8 text-slate-400 text-sm">Loading…</div>

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold text-white mb-1">Feature Flags</h1>
      <p className="text-slate-400 text-sm mb-6">Operational kill-switches — separate from the commercial tier/entitlement system.</p>

      <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark mb-6">
        {flags.map((f) => (
          <div key={f.flag_key} className="flex items-center justify-between px-5 py-3.5 border-b border-white/5 last:border-0">
            <div>
              <p className="text-white text-sm font-medium">{f.flag_key}</p>
              <p className="text-slate-500 text-xs mt-0.5">{f.description}</p>
            </div>
            <button
              onClick={() => toggleDefault(f.flag_key, f.default_enabled)}
              disabled={toggling === f.flag_key}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition disabled:opacity-40 ${
                f.default_enabled ? 'bg-[#16a34a]/15 text-[#16a34a]' : 'bg-white/5 text-slate-400'
              }`}
            >
              {f.default_enabled ? 'Enabled by default' : 'Disabled by default'}
            </button>
          </div>
        ))}
      </div>

      <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark mb-6">
        <h2 className="text-white font-medium text-sm mb-3">Add Org Override</h2>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" value={overrideOrgId} onChange={(e) => setOverrideOrgId(e.target.value)}>
            <option value="">Org…</option>
            {orgs.map((o) => <option key={o.org_id} value={o.org_id}>{o.name}</option>)}
          </select>
          <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" value={overrideFlagKey} onChange={(e) => setOverrideFlagKey(e.target.value)}>
            <option value="">Flag…</option>
            {flags.map((f) => <option key={f.flag_key} value={f.flag_key}>{f.flag_key}</option>)}
          </select>
          <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" value={overrideEnabled ? 'true' : 'false'} onChange={(e) => setOverrideEnabled(e.target.value === 'true')}>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </div>
        <button
          onClick={addOverride}
          disabled={savingOverride || !overrideOrgId || !overrideFlagKey}
          className="px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition"
        >
          {savingOverride ? 'Saving…' : 'Add Override'}
        </button>
      </div>

      <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
        <div className="px-5 py-3.5 border-b border-white/5">
          <h2 className="text-white font-medium text-sm">Active Overrides ({overrides.length})</h2>
        </div>
        {overrides.length === 0 ? (
          <div className="px-5 py-8 text-center text-slate-500 text-sm">No per-org overrides set.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {overrides.map((o, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-white">{o.org_name ?? o.org_id}</span>
                <span className="text-slate-400">{o.flag_key}</span>
                <span className={o.enabled ? 'text-[#16a34a]' : 'text-slate-500'}>{o.enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
