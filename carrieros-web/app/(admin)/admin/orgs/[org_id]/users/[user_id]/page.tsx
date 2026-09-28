'use client'

import { useEffect, useState, use as usePromise } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardBody, CardHeader, StatusBadge, Table, TableCell, TableHeaderCell, TableRow } from '@/components/ui'

interface Activity { id: number; action: string; aggregate_type: string; aggregate_id: string | null; operation: string; occurred_at: string }
interface LegacyAuditEvent { id: number; action: string; aggregate_type: string; aggregate_id: string; prior_state: string | null; new_state: string | null; reason: string | null; occurred_at: string }
interface SupportAccess { id: string; ticket_id: number | null; reason: string; started_at: string; expires_at: string; ended_at: string | null }
interface SupportTicket { id: number; category: string; status: string; created_at: string; updated_at: string }
interface UserDetail {
  user: { id: string; name: string | null; email: string | null; phone: string | null; role: string; is_active: boolean; auth_account_exists: boolean; auth_created_at: string | null; confirmed_at: string | null; last_sign_in_at: string | null; banned_until: string | null; is_anonymous: boolean }
  activity: Activity[]
  legacy_audit_events: LegacyAuditEvent[]
  support_access_sessions: SupportAccess[]
  support_tickets: SupportTicket[]
  coverage: { tenant_writes: string; not_recorded: string[] }
}

function dateLabel(value: string | null, unavailable: string) {
  return value ? new Date(value).toLocaleString() : unavailable
}

export default function AdminUserAccessPage({ params }: { params: Promise<{ org_id: string; user_id: string }> }) {
  const { org_id, user_id } = usePromise(params)
  const t = useTranslations('admin.userAccess')
  const [data, setData] = useState<UserDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/orgs/${org_id}/users/${user_id}`)
      .then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<UserDetail> })
      .then(result => { if (!cancelled) setData(result) })
      .catch(() => { if (!cancelled) setError(t('error')) })
    return () => { cancelled = true }
  }, [org_id, user_id, t])

  if (error) return <div className="p-8 text-sm text-danger">{error}</div>
  if (!data) return <div className="p-8 text-sm text-text-sec">{t('loading')}</div>
  const user = data.user
  const unavailable = t('unavailable')

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-5">
      <Link href={`/admin/orgs/${org_id}`} className="text-sm text-text-sec hover:text-text-pri">← {t('backToCarrier')}</Link>
      <header>
        <h1 className="text-2xl font-semibold text-text-pri">{user.name ?? user.email ?? user.id}</h1>
        <p className="text-sm text-text-sec mt-1">{user.email ?? unavailable} · {user.role}</p>
      </header>

      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('accountTitle')}</h2></CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div><p className="text-xs text-text-mut">{t('profileStatus')}</p><StatusBadge size="sm" variant={user.is_active ? 'success' : 'danger'}>{user.is_active ? t('active') : t('inactive')}</StatusBadge></div>
          <div><p className="text-xs text-text-mut">{t('authAccount')}</p><p className="text-text-pri">{user.auth_account_exists ? t('present') : t('missing')}</p></div>
          <div><p className="text-xs text-text-mut">{t('created')}</p><p className="text-text-pri">{dateLabel(user.auth_created_at, unavailable)}</p></div>
          <div><p className="text-xs text-text-mut">{t('confirmed')}</p><p className="text-text-pri">{dateLabel(user.confirmed_at, unavailable)}</p></div>
          <div><p className="text-xs text-text-mut">{t('lastSignIn')}</p><p className="text-text-pri">{dateLabel(user.last_sign_in_at, unavailable)}</p></div>
          <div><p className="text-xs text-text-mut">{t('bannedUntil')}</p><p className="text-text-pri">{dateLabel(user.banned_until, t('notBanned'))}</p></div>
        </CardBody>
      </Card>

      <Card className="p-4"><p className="text-sm text-text-sec">{t('coverageNote')}</p><p className="mt-2 text-xs text-text-mut">{t('coverageMissing')}</p></Card>

      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('activityTitle', { count: data.activity.length })}</h2></CardHeader>
        {data.activity.length === 0 ? <CardBody><p className="text-sm text-text-mut">{t('noActivity')}</p></CardBody> : (
          <Table><thead><tr><TableHeaderCell>{t('action')}</TableHeaderCell><TableHeaderCell>{t('record')}</TableHeaderCell><TableHeaderCell>{t('when')}</TableHeaderCell></tr></thead>
            <tbody>{data.activity.map(event => <TableRow key={event.id}>
              <TableCell><span className="font-medium text-text-pri">{event.action}</span><span className="block text-xs text-text-mut">{event.operation}</span></TableCell>
              <TableCell className="text-text-sec">{event.aggregate_type}{event.aggregate_id ? ` #${event.aggregate_id}` : ''}</TableCell>
              <TableCell className="text-xs text-text-mut">{dateLabel(event.occurred_at, unavailable)}</TableCell>
            </TableRow>)}</tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('shipmentAuditTitle', { count: data.legacy_audit_events.length })}</h2></CardHeader>
        {data.legacy_audit_events.length === 0 ? <CardBody><p className="text-sm text-text-mut">{t('noShipmentAudit')}</p></CardBody> : (
          <div className="divide-y divide-divider-ui">{data.legacy_audit_events.map(event => <div key={event.id} className="px-5 py-3 text-sm">
            <p className="text-text-pri">{event.action} · {event.aggregate_type} #{event.aggregate_id}</p>
            <p className="text-xs text-text-mut">{event.prior_state ?? '—'} → {event.new_state ?? '—'} · {dateLabel(event.occurred_at, unavailable)}</p>
            {event.reason && <p className="text-xs text-text-sec mt-1">{event.reason}</p>}
          </div>)}</div>
        )}
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('supportAccessTitle', { count: data.support_access_sessions.length })}</h2></CardHeader>
        {data.support_access_sessions.length === 0 ? <CardBody><p className="text-sm text-text-mut">{t('noSupportAccess')}</p></CardBody> : (
          <div className="divide-y divide-divider-ui">{data.support_access_sessions.map(session => <div key={session.id} className="px-5 py-3 text-sm">
            <p className="text-text-pri">{session.reason}</p>
            <p className="text-xs text-text-mut">{dateLabel(session.started_at, unavailable)} · {session.ended_at ? t('ended') : t('expiresAt', { date: dateLabel(session.expires_at, unavailable) })}{session.ticket_id ? ` · #${session.ticket_id}` : ''}</p>
          </div>)}</div>
        )}
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('ticketsTitle', { count: data.support_tickets.length })}</h2></CardHeader>
        {data.support_tickets.length === 0 ? <CardBody><p className="text-sm text-text-mut">{t('noTickets')}</p></CardBody> : (
          <div className="divide-y divide-divider-ui">{data.support_tickets.map(ticket => <Link href={`/admin/support/${ticket.id}`} key={ticket.id} className="px-5 py-3 flex justify-between text-sm hover:bg-surface-subtle">
            <span className="text-text-pri">#{ticket.id} · {ticket.category}</span><span className="text-text-mut">{ticket.status} · {dateLabel(ticket.created_at, unavailable)}</span>
          </Link>)}</div>
        )}
      </Card>
    </div>
  )
}
