'use client'

import { FormEvent, useEffect, useState, use as usePromise } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button, Card, CardBody, CardHeader, Input, StatusBadge } from '@/components/ui'

type Stage = 'intake' | 'setup' | 'training' | 'launch_ready' | 'live' | 'blocked'
interface CaseData {
  onboarding: { org_id: number; company_name: string; tier: string; billing_status: string; contact_name: string; contact_email: string; stage: Stage; next_action: string | null; next_follow_up_at: string | null; blocker_note: string | null; owner_invite_sent_at: string | null }
  owner: { id: string; name: string | null; email: string; confirmed_at: string | null; last_sign_in_at: string | null } | null
  progress: { owner_invited: boolean; owner_signed_in: boolean; active_vehicles: number; active_drivers: number; loads: number; invoices: number; active_team_users: number }
}

const STAGES: Stage[] = ['intake', 'setup', 'training', 'launch_ready', 'live', 'blocked']
function toLocalDate(value: string | null) { return value ? new Date(value).toISOString().slice(0, 16) : '' }

export default function AdminOnboardingDetailPage({ params }: { params: Promise<{ org_id: string }> }) {
  const { org_id } = usePromise(params)
  const t = useTranslations('admin.onboarding')
  const [data, setData] = useState<CaseData | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [stage, setStage] = useState<Stage>('intake')
  const [nextAction, setNextAction] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [blocker, setBlocker] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')

  async function load() {
    const response = await fetch(`/api/admin/onboarding/${org_id}`)
    if (!response.ok) throw new Error()
    const result = await response.json() as CaseData
    setData(result); setStage(result.onboarding.stage); setNextAction(result.onboarding.next_action ?? '')
    setFollowUp(toLocalDate(result.onboarding.next_follow_up_at)); setBlocker(result.onboarding.blocker_note ?? '')
    setFirstName(result.onboarding.contact_name.split(/\s+/)[0] ?? '')
    setLastName(result.onboarding.contact_name.split(/\s+/).slice(1).join(' '))
    setEmail(result.onboarding.contact_email)
    setError('')
  }
  useEffect(() => { let cancelled = false; void Promise.resolve().then(() => load().catch(() => { if (!cancelled) setError(t('error')) })); return () => { cancelled = true } /* eslint-disable-line react-hooks/exhaustive-deps */ }, [org_id])

  async function saveCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const response = await fetch(`/api/admin/onboarding/${org_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage, next_action: nextAction || null, next_follow_up_at: followUp ? new Date(followUp).toISOString() : null, blocker_note: blocker || null }) })
      if (!response.ok) throw new Error()
      await load()
    } catch { setError(t('saveError')) } finally { setSaving(false) }
  }

  async function inviteOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setInviting(true); setError('')
    try {
      const response = await fetch(`/api/admin/onboarding/${org_id}/owner-invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ first_name: firstName, last_name: lastName, email }) })
      if (!response.ok) throw new Error()
      await load()
    } catch { setError(t('inviteError')) } finally { setInviting(false) }
  }

  if (error && !data) return <div className="p-8 text-sm text-danger">{error}</div>
  if (!data) return <div className="p-8 text-sm text-text-sec">{t('loading')}</div>
  const onboarding = data.onboarding
  const milestones = [
    ['owner_invited', data.progress.owner_invited, data.progress.owner_invited ? t('ownerAdded') : t('ownerPending')],
    ['owner_signed_in', data.progress.owner_signed_in, t('ownerSignedIn')],
    ['vehicles', data.progress.active_vehicles > 0, t('vehiclesAdded', { count: data.progress.active_vehicles })],
    ['drivers', data.progress.active_drivers > 0, t('driversAdded', { count: data.progress.active_drivers })],
    ['loads', data.progress.loads > 0, t('loadsAdded', { count: data.progress.loads })],
    ['invoices', data.progress.invoices > 0, t('invoicesAdded', { count: data.progress.invoices })],
  ] as const

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-5">
      <Link href="/admin/onboarding" className="text-sm text-text-sec hover:text-text-pri">← {t('backToOnboarding')}</Link>
      <header><div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold text-text-pri">{onboarding.company_name}</h1><StatusBadge size="sm" variant={stage === 'blocked' ? 'danger' : stage === 'live' ? 'success' : 'info'}>{t(`stage.${stage}`)}</StatusBadge></div><p className="text-sm text-text-sec mt-1">{onboarding.tier} · {onboarding.billing_status} · {onboarding.contact_name} · {onboarding.contact_email}</p></header>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('workflowTitle')}</h2></CardHeader>
        <CardBody>
          <form onSubmit={saveCase} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input as="select" value={stage} onChange={event => setStage(event.target.value as Stage)} aria-label={t('stageLabel')}>{STAGES.map(value => <option key={value} value={value}>{t(`stage.${value}`)}</option>)}</Input>
              <Input type="datetime-local" value={followUp} onChange={event => setFollowUp(event.target.value)} aria-label={t('followUpLabel')} />
            </div>
            <Input value={nextAction} onChange={event => setNextAction(event.target.value)} maxLength={500} placeholder={t('nextAction')} aria-label={t('nextAction')} />
            {stage === 'blocked' && <Input as="textarea" rows={3} maxLength={2000} value={blocker} onChange={event => setBlocker(event.target.value)} placeholder={t('blocker')} aria-label={t('blocker')} />}
            <Button type="submit" loading={saving}>{t('saveWorkflow')}</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('ownerTitle')}</h2></CardHeader>
        <CardBody>
          {data.owner ? <div className="text-sm"><p className="text-text-pri">{data.owner.name ?? data.owner.email}</p><p className="text-xs text-text-mut">{data.owner.email} · {data.progress.owner_signed_in ? t('ownerSignedIn') : t('ownerPending')}{data.owner.confirmed_at ? ` · ${t('confirmed')}` : ''}</p></div> : (
            <>
              <p className="text-xs text-text-mut mb-3">{t('inviteWillEmail')}</p>
              <form onSubmit={inviteOwner} className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input required maxLength={80} value={firstName} onChange={event => setFirstName(event.target.value)} placeholder={t('firstName')} aria-label={t('firstName')} />
                <Input required maxLength={80} value={lastName} onChange={event => setLastName(event.target.value)} placeholder={t('lastName')} aria-label={t('lastName')} />
                <Input required type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder={t('contactEmail')} aria-label={t('contactEmail')} />
                <Button type="submit" loading={inviting}>{t('sendOwnerInvite')}</Button>
              </form>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('checklistTitle')}</h2></CardHeader>
        <CardBody>
          <p className="text-xs text-text-mut mb-3">{t('checklistNote')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{milestones.map(([key, done, label]) => <div key={key} className="flex items-center gap-2 text-sm"><span className={`material-symbols-outlined text-[18px] ${done ? 'text-success' : 'text-text-mut'}`}>{done ? 'check_circle' : 'radio_button_unchecked'}</span><span className={done ? 'text-text-sec' : 'text-text-mut'}>{label}</span></div>)}</div>
        </CardBody>
      </Card>
    </div>
  )
}
