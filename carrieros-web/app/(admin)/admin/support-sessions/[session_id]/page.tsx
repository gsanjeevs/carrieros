'use client'

import { useEffect, useState, use as usePromise } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Card, CardBody, CardHeader } from '@/components/ui'

interface TicketSummary {
  id: number
  category: string
  related_load_number: string | null
  body?: string
  status: string
  created_at: string
  updated_at: string
}

interface SupportContext {
  session: { id: string; reason: string; started_at: string; expires_at: string }
  organization: { id: number; name: string }
  user: {
    id: string
    name: string | null
    role: string
    is_active: boolean
    created_at: string | null
    email: string | null
    last_sign_in_at: string | null
    auth_account_found: boolean | null
  }
  linked_ticket: TicketSummary | null
  linked_ticket_messages: { id: number; sender_id: string | null; body: string; is_ai_generated: boolean; created_at: string }[]
  recent_tickets: TicketSummary[]
  recorded_actions: {
    id: number
    action: string
    aggregate_type: string
    aggregate_id: string
    prior_state: string | null
    new_state: string | null
    reason: string | null
    occurred_at: string
  }[]
  scope: string
}

export default function SupportSessionPage({ params }: { params: Promise<{ session_id: string }> }) {
  const { session_id } = usePromise(params)
  const router = useRouter()
  const t = useTranslations('admin.supportAccess')
  const [context, setContext] = useState<SupportContext | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function loadContext() {
    try {
      const response = await fetch(`/api/admin/support-sessions/${session_id}`)
      if (response.status === 404) throw new Error(t('sessionNotFound'))
      if (response.status === 410) throw new Error(t('sessionExpired'))
      if (!response.ok) throw new Error(t('loadFailed'))
      const data = await response.json()
      setContext(data)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('loadFailed'))
      setContext(null)
    }
  }

  useEffect(() => {
    void Promise.resolve().then(loadContext)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session_id])

  useEffect(() => {
    if (!context) return
    const timeout = window.setTimeout(() => {
      setContext(null)
      setError(t('sessionExpired'))
    }, Math.max(0, new Date(context.session.expires_at).getTime() - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [context, t])

  async function endSession() {
    setBusy(true)
    try {
      const response = await fetch(`/api/admin/support-sessions/${session_id}`, { method: 'DELETE' })
      if (response.ok) {
        router.push(`/admin/orgs/${context?.organization.id ?? ''}`)
        return
      }
      const data = await response.json().catch(() => ({}))
      if (data.meta?.session_ended) {
        router.push(`/admin/orgs/${context?.organization.id ?? ''}`)
        return
      }
      setError(t('endFailed'))
    } catch {
      setError(t('endFailed'))
    }
    setBusy(false)
  }

  if (!context) {
    return <div className="p-8 max-w-4xl mx-auto">
      <p role="alert" className="text-danger text-sm">{error || t('loading')}</p>
      <Link href="/admin/health" className="inline-block mt-4 text-sm text-brand-orange">{t('backToHealth')}</Link>
    </div>
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <section className="sticky top-0 z-10 -mx-2 rounded-xl border border-warning/40 bg-warning/10 p-4 shadow-md backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-text-pri">{t('bannerTitle')}</p>
            <p className="text-xs text-text-sec">{t('bannerBody', { time: new Date(context.session.expires_at).toLocaleTimeString() })}</p>
          </div>
          <Button variant="secondary" onClick={endSession} loading={busy}>{t('endSession')}</Button>
        </div>
      </section>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-text-mut">{context.organization.name}</p>
          <h1 className="text-2xl font-semibold text-text-pri">{context.user.name ?? context.user.email ?? context.user.id}</h1>
          <p className="text-sm text-text-sec">{context.user.email ?? t('noEmail')} · {context.user.role}</p>
        </div>
        <Button variant="secondary" onClick={() => void loadContext()}>{t('refresh')}</Button>
      </div>

      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('sessionTitle')}</h2></CardHeader>
        <CardBody className="space-y-2 text-sm">
          <p><span className="text-text-mut">{t('reasonLabel')}: </span><span className="text-text-pri">{context.session.reason}</span></p>
          <p className="text-text-sec">{context.scope}</p>
          {error && <p role="alert" className="text-danger">{error}</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('accessDetailsTitle')}</h2></CardHeader>
        <CardBody className="grid gap-3 sm:grid-cols-2 text-sm">
          <Info label={t('roleLabel')} value={context.user.role} />
          <Info label={t('accountStatusLabel')} value={context.user.is_active ? t('active') : t('inactive')} />
          <Info label={t('lastSignInLabel')} value={context.user.auth_account_found === null ? t('unknown') : context.user.last_sign_in_at ? new Date(context.user.last_sign_in_at).toLocaleString() : t('never')} />
          <Info label={t('accountFoundLabel')} value={context.user.auth_account_found === null ? t('unknown') : context.user.auth_account_found ? t('yes') : t('no')} />
          <Info label={t('profileCreatedLabel')} value={context.user.created_at ? new Date(context.user.created_at).toLocaleString() : '—'} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('recordedActionsTitle')}</h2></CardHeader>
        {context.recorded_actions.length === 0 ? <CardBody><p className="text-sm text-text-mut">{t('noRecordedActions')}</p></CardBody> : (
          <div className="divide-y divide-divider-ui">
            {context.recorded_actions.map(action => (
              <div key={action.id} className="px-5 py-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="text-sm font-medium text-text-pri">{action.action} · {action.aggregate_type} #{action.aggregate_id}</p>
                  <time className="text-xs text-text-mut">{new Date(action.occurred_at).toLocaleString()}</time>
                </div>
                {(action.prior_state || action.new_state) && <p className="mt-1 text-xs text-text-sec">{action.prior_state ?? '—'} → {action.new_state ?? '—'}</p>}
                {action.reason && <p className="mt-1 text-sm text-text-sec">{action.reason}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {context.linked_ticket && (
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-text-pri">{t('linkedTicketTitle', { id: context.linked_ticket.id })}</h2>
            <Link href={`/admin/support/${context.linked_ticket.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-orange">{t('openTicket')}</Link>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-xs text-text-mut">{context.linked_ticket.category} · {context.linked_ticket.status} · {new Date(context.linked_ticket.created_at).toLocaleString()}</p>
            <p className="whitespace-pre-wrap text-sm text-text-pri">{context.linked_ticket.body}</p>
            <div className="border-t border-divider-ui pt-3 space-y-3">
              {context.linked_ticket_messages.map(message => (
                <div key={message.id} className="rounded-lg bg-surface-subtle p-3">
                  <p className="text-xs text-text-mut">{message.is_ai_generated ? t('aiReply') : t('staffOrUserReply')} · {new Date(message.created_at).toLocaleString()}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-text-sec">{message.body}</p>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('recentTicketsTitle')}</h2></CardHeader>
        {context.recent_tickets.length === 0 ? <CardBody><p className="text-sm text-text-mut">{t('noTickets')}</p></CardBody> : (
          <div className="divide-y divide-divider-ui">
            {context.recent_tickets.map(ticket => (
              <Link key={ticket.id} href={`/admin/support/${ticket.id}`} target="_blank" rel="noopener noreferrer" className="flex justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-subtle">
                <span className="text-text-pri">#{ticket.id} · {ticket.category}{ticket.related_load_number ? ` · ${ticket.related_load_number}` : ''}</span>
                <span className="text-text-mut">{ticket.status} · {new Date(ticket.created_at).toLocaleDateString()}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <p className="text-xs text-text-mut">{t('activityGap')}</p>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-text-mut">{label}</p><p className="text-text-pri">{value}</p></div>
}
