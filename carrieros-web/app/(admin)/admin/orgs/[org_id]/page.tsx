'use client'
// app/(admin)/admin/orgs/[org_id]/page.tsx — Org Detail (audit gap #14).
// Client-fetched from GET /api/admin/orgs/[org_id] (KPIs, adoption
// checklist, users, recent loads, notes) plus the notes/tier/trial/
// grace-period/impersonate action routes, all of which already existed
// except trial and grace-period (added this pass).
//
// Uses components/ui/* (Card/CardHeader/CardBody/KpiTile/Button/Input) per
// docs/design/carrieros-design-system.md §5 rather than hand-rolled Tailwind.
import { useEffect, useState, use as usePromise } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardHeader, CardBody, KpiTile, Button, Input } from '@/components/ui'

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

export default function OrgDetailPage({ params }: { params: Promise<{ org_id: string }> }) {
  const { org_id } = usePromise(params)
  const t = useTranslations('admin.orgDetail')

  const ADOPTION_LABELS: Record<string, string> = {
    completed_onboarding: t('adoptionCompletedOnboarding'),
    added_first_vehicle: t('adoptionAddedFirstVehicle'),
    added_first_driver: t('adoptionAddedFirstDriver'),
    created_first_load: t('adoptionCreatedFirstLoad'),
    dispatched_load: t('adoptionDispatchedLoad'),
    sent_first_invoice: t('adoptionSentFirstInvoice'),
    received_first_payment: t('adoptionReceivedFirstPayment'),
  }

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
      setError(t('error'))
    }
  }

  useEffect(() => {
    // Deferred a microtask so the initial fetch's state updates are not a
    // synchronous setState in the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (error) return <div className="p-8 text-danger text-sm">{error}</div>
  if (!data) return <div className="p-8 text-text-sec text-sm">{t('loading')}</div>

  const cd = data.carrier_details

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/admin/health" className="text-text-sec text-sm hover:text-text-pri flex items-center gap-1.5 mb-4">
        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        {t('backToHealth')}
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text-pri">{data.org.name}</h1>
          <p className="text-text-sec text-sm mt-1">
            {cd?.tier ?? '—'} · {cd?.billing_status ?? '—'}
            {cd?.trial_ends_at && t('trialEndsLabel', { date: new Date(cd.trial_ends_at).toLocaleDateString() })}
          </p>
        </div>
        <Button onClick={impersonate} loading={busyAction === 'impersonate'}>
          {t('impersonateOwner')}
        </Button>
      </div>

      {impersonateLink && (
        <div className="mb-6 rounded-lg bg-brand-orange/10 border border-brand-orange/20 px-4 py-3">
          <p className="text-brand-orange text-xs mb-1">{t('magicLink')}</p>
          <code className="text-text-sec text-xs break-all">{impersonateLink}</code>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-text-pri font-medium text-sm">{t('kpisTitle')}</h2>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-3 gap-4">
                <KpiTile label={t('loadsPer30d')} value={data.kpis.loads_this_month} />
                <KpiTile label={t('uninvoicedRevenue')} value={`$${data.kpis.uninvoiced_revenue.toLocaleString()}`} />
                <KpiTile label={t('lastActive')} value={data.kpis.last_active ? new Date(data.kpis.last_active).toLocaleDateString() : t('never')} />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-text-pri font-medium text-sm">{t('adoptionTitle')}</h2>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(data.adoption).map(([key, done]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className={`material-symbols-outlined text-[18px] ${done ? 'text-success' : 'text-text-mut'}`}>
                      {done ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <span className={`text-sm ${done ? 'text-text-sec' : 'text-text-mut'}`}>{ADOPTION_LABELS[key] ?? key}</span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-text-pri font-medium text-sm">{t('usersTitle', { count: data.users.length })}</h2>
            </CardHeader>
            <div className="divide-y divide-divider-ui">
              {data.users.map((u) => (
                <div key={u.id} className="px-5 py-2.5 flex items-center justify-between text-sm">
                  <span className="text-text-pri">{u.name ?? u.email ?? u.id}</span>
                  <span className="text-text-mut text-xs capitalize">{u.role}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-text-pri font-medium text-sm">{t('recentLoadsTitle')}</h2>
            </CardHeader>
            {data.recent_loads.length === 0 ? (
              <CardBody>
                <p className="text-text-mut text-sm">{t('noLoadsYet')}</p>
              </CardBody>
            ) : (
              <div className="divide-y divide-divider-ui">
                {data.recent_loads.slice(0, 10).map((l) => (
                  <div key={l.id} className="px-5 py-2.5 flex items-center justify-between text-sm">
                    <span className="text-text-sec capitalize">{l.status ?? '—'}</span>
                    <span className="text-text-pri">${(l.rate ?? 0).toLocaleString()}</span>
                    <span className="text-text-mut text-xs">{new Date(l.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardBody>
              <h2 className="text-text-pri font-medium text-sm mb-3">{t('tierTitle')}</h2>
              <Input as="select" value={cd?.tier ?? ''} onChange={(e) => changeTier(e.target.value)} disabled={savingTier}>
                {TIERS.map((tier) => (
                  <option key={tier} value={tier}>{tier.charAt(0).toUpperCase() + tier.slice(1)}</option>
                ))}
              </Input>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h2 className="text-text-pri font-medium text-sm mb-3">{t('trialGraceTitle')}</h2>
              <Button variant="secondary" className="w-full mb-2" onClick={extendTrial} loading={busyAction === 'trial'}>
                {t('extendTrial7')}
              </Button>
              <p className="text-text-mut text-xs mb-2">
                {t('gracePeriodLabel', { date: cd?.grace_period_until ? new Date(cd.grace_period_until).toLocaleDateString() : t('none') })}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => setGracePeriod(7)} loading={busyAction === 'grace'}>
                  {t('set7d')}
                </Button>
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => setGracePeriod(null)} loading={busyAction === 'grace'}>
                  {t('clear')}
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h2 className="text-text-pri font-medium text-sm mb-3">{t('notesTitle')}</h2>
              <div className="space-y-2 mb-3 max-h-60 overflow-y-auto">
                {data.notes.length === 0 ? (
                  <p className="text-text-mut text-sm">{t('noNotesYet')}</p>
                ) : (
                  data.notes.map((n) => (
                    <div key={n.id} className="bg-surface-subtle rounded-lg px-3 py-2">
                      <p className="text-text-sec text-sm">{n.body}</p>
                      <p className="text-text-mut text-[10px] mt-1">{new Date(n.created_at).toLocaleString()}</p>
                    </div>
                  ))
                )}
              </div>
              <Input
                as="textarea"
                rows={2}
                placeholder={t('addNotePlaceholder')}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                className="resize-none mb-2"
              />
              <Button className="w-full" onClick={addNote} disabled={!noteDraft.trim()} loading={savingNote}>
                {t('addNote')}
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
