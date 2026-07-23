'use client'
// app/(admin)/admin/flags/page.tsx — Feature Flags (audit gap #14).
// platform_flags/org_flag_overrides had schema + RLS but no UI or API
// route until this pass (GET/PATCH /api/admin/flags, POST .../override).
// Global default toggle is sx_owner only (matches RLS); per-org override
// creation reuses the same org list from /api/admin/orgs for the picker.
//
// Uses components/ui/* (Card/CardHeader/Button/Input/StatusBadge/
// EmptyState) per docs/design/carrieros-design-system.md §5 rather than
// hand-rolled Tailwind.
import { useEffect, useState } from 'react'
import { Card, CardHeader, Button, Input, StatusBadge, EmptyState } from '@/components/ui'

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

  if (error) return <div className="p-8 text-danger text-sm">{error}</div>
  if (!flags || !overrides) return <div className="p-8 text-text-sec text-sm">Loading…</div>

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold text-text-pri mb-1">Feature Flags</h1>
      <p className="text-text-sec text-sm mb-6">Operational kill-switches — separate from the commercial tier/entitlement system.</p>

      <Card className="mb-6">
        {flags.map((f) => (
          <div key={f.flag_key} className="flex items-center justify-between px-5 py-3.5 border-b border-divider-ui last:border-0">
            <div>
              <p className="text-text-pri text-sm font-medium">{f.flag_key}</p>
              <p className="text-text-mut text-xs mt-0.5">{f.description}</p>
            </div>
            <button onClick={() => toggleDefault(f.flag_key, f.default_enabled)} disabled={toggling === f.flag_key} className="disabled:opacity-40">
              <StatusBadge variant={f.default_enabled ? 'success' : 'neutral'}>
                {f.default_enabled ? 'Enabled by default' : 'Disabled by default'}
              </StatusBadge>
            </button>
          </div>
        ))}
      </Card>

      <Card className="p-5 mb-6">
        <h2 className="text-text-pri font-medium text-sm mb-3">Add Org Override</h2>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <Input as="select" value={overrideOrgId} onChange={(e) => setOverrideOrgId(e.target.value)}>
            <option value="">Org…</option>
            {orgs.map((o) => <option key={o.org_id} value={o.org_id}>{o.name}</option>)}
          </Input>
          <Input as="select" value={overrideFlagKey} onChange={(e) => setOverrideFlagKey(e.target.value)}>
            <option value="">Flag…</option>
            {flags.map((f) => <option key={f.flag_key} value={f.flag_key}>{f.flag_key}</option>)}
          </Input>
          <Input as="select" value={overrideEnabled ? 'true' : 'false'} onChange={(e) => setOverrideEnabled(e.target.value === 'true')}>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </Input>
        </div>
        <Button onClick={addOverride} disabled={!overrideOrgId || !overrideFlagKey} loading={savingOverride}>
          Add Override
        </Button>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-text-pri font-medium text-sm">Active Overrides ({overrides.length})</h2>
        </CardHeader>
        {overrides.length === 0 ? (
          <EmptyState icon="flag" title="No per-org overrides set." />
        ) : (
          <div className="divide-y divide-divider-ui">
            {overrides.map((o, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-text-pri">{o.org_name ?? o.org_id}</span>
                <span className="text-text-sec">{o.flag_key}</span>
                <StatusBadge variant={o.enabled ? 'success' : 'neutral'} size="sm">{o.enabled ? 'Enabled' : 'Disabled'}</StatusBadge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
