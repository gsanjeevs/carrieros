'use client'
// app/(admin)/admin/roles/page.tsx — Role Capabilities screen.
// role_capabilities (migrations 0009/0023/0024) is the source-of-truth
// table, but it is NOT read live: scripts/gen-role-capabilities.mjs
// snapshots it into lib/generated/role-capabilities.ts, which is what
// proxy.ts's ROLE_ROUTES and every roleHasCapability() call actually read.
// Toggling a cell here only edits the table — it is explicitly NOT "live"
// until Regenerate is run AND the resulting generated files are committed
// and deployed. This page never claims otherwise.
//
// Uses components/ui/* per docs/design/carrieros-design-system.md §5
// rather than hand-rolled Tailwind, same as flags/page.tsx.
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardHeader, Button, Callout, EmptyState } from '@/components/ui'

interface Role {
  code: string
  label: string
  scope: string
  display_order: number
}

interface Grant {
  role: string
  capability: string
}

export default function RoleCapabilitiesPage() {
  const t = useTranslations('admin.roles')
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [capabilities, setCapabilities] = useState<string[] | null>(null)
  const [grants, setGrants] = useState<Grant[] | null>(null)
  const [error, setError] = useState('')
  const [toggling, setToggling] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [regenResult, setRegenResult] = useState<{ changed: boolean; changedFiles: string[] } | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/admin/roles')
      if (!res.ok) throw new Error()
      const json = await res.json()
      setRoles(json.roles)
      setCapabilities(json.capabilities)
      setGrants(json.grants)
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

  function hasGrant(role: string, capability: string) {
    return (grants ?? []).some((g) => g.role === role && g.capability === capability)
  }

  async function toggle(role: string, capability: string) {
    const key = `${role}:${capability}`
    const current = hasGrant(role, capability)
    setToggling(key)
    const res = await fetch('/api/admin/roles', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, capability, enabled: !current }),
    })
    setToggling(null)
    if (res.ok) {
      setDirty(true)
      setRegenResult(null)
      await load()
    }
  }

  async function regenerate() {
    setRegenerating(true)
    try {
      const res = await fetch('/api/admin/roles/regenerate', { method: 'POST' })
      if (res.ok) {
        const json = await res.json()
        setRegenResult({ changed: json.changed, changedFiles: json.changedFiles })
        setDirty(false)
      } else {
        setError(t('regenerateError'))
      }
    } finally {
      setRegenerating(false)
    }
  }

  if (error) return <div className="p-8 text-danger text-sm">{error}</div>
  if (!roles || !capabilities || !grants) return <div className="p-8 text-text-sec text-sm">{t('loading')}</div>

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold text-text-pri mb-1">{t('title')}</h1>
      <p className="text-text-sec text-sm mb-4">{t('subtitle')}</p>

      <Callout tone="warning" icon="info" className="mb-6 max-w-3xl">
        {t('notLiveNotice')}
      </Callout>

      {dirty && (
        <Callout tone="orange" icon="sync" className="mb-6 max-w-3xl">
          <div className="flex items-center justify-between gap-4 w-full">
            <span>{t('savedRegenerateToApply')}</span>
            <Button size="sm" variant="secondary" onClick={regenerate} loading={regenerating}>
              {t('regenerateButton')}
            </Button>
          </div>
        </Callout>
      )}

      {regenResult && (
        <Callout tone={regenResult.changed ? 'success' : 'info'} icon={regenResult.changed ? 'check_circle' : 'info'} className="mb-6 max-w-3xl">
          {regenResult.changed
            ? t('regenerateChanged', { files: regenResult.changedFiles.join(', ') })
            : t('regenerateNoChanges')}
          {' '}
          {t('regenerateDeployReminder')}
        </Callout>
      )}

      {!dirty && !regenResult && (
        <div className="mb-6">
          <Button size="sm" variant="secondary" onClick={regenerate} loading={regenerating}>
            {t('regenerateButton')}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-text-pri font-medium text-sm">{t('matrixTitle')}</h2>
        </CardHeader>
        {capabilities.length === 0 ? (
          <EmptyState icon="admin_panel_settings" title={t('noCapabilities')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-divider-ui">
                  <th className="text-left px-4 py-2.5 text-text-mut font-medium sticky left-0 bg-surface-card">
                    {t('capabilityColumn')}
                  </th>
                  {roles.map((r) => (
                    <th key={r.code} className="px-3 py-2.5 text-text-mut font-medium text-center whitespace-nowrap">
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {capabilities.map((cap) => (
                  <tr key={cap} className="border-b border-divider-ui last:border-0">
                    <td className="px-4 py-2 text-text-pri font-mono text-xs sticky left-0 bg-surface-card">{cap}</td>
                    {roles.map((r) => {
                      const key = `${r.code}:${cap}`
                      const granted = hasGrant(r.code, cap)
                      return (
                        <td key={key} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            aria-label={t('toggleAriaLabel', { role: r.label, capability: cap })}
                            checked={granted}
                            disabled={toggling === key}
                            onChange={() => toggle(r.code, cap)}
                            className="w-4 h-4 accent-brand-orange disabled:opacity-40"
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
