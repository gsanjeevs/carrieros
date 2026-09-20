'use client'
// app/(admin)/admin/audit/page.tsx — Audit & Activity (audit gap #14).
// GET /api/admin/audit — see that route's own header comment on scope:
// admin_events only logs admin-INITIATED actions (notes, tier/trial/
// grace-period changes, flag overrides, impersonation), not a full
// cross-tenant audit trail (no login/load/billing event logging exists).
//
// Uses components/ui/* (Card/Table/EmptyState) per docs/design/
// carrieros-design-system.md §5 rather than hand-rolled Tailwind.
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, Table, TableHeaderCell, TableRow, TableCell, EmptyState } from '@/components/ui'

interface AuditEvent {
  id: number
  event_type: string
  metadata: Record<string, unknown> | null
  created_at: string
  org_name: string | null
  admin_name: string | null
}

export default function AuditPage() {
  const t = useTranslations('admin.audit')
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [error, setError] = useState('')

  const EVENT_LABELS: Record<string, string> = {
    'admin.note_add': t('eventNoteAdd'),
    'admin.impersonate': t('eventImpersonate'),
    'admin.change_tier': t('eventChangeTier'),
    'admin.extend_trial': t('eventExtendTrial'),
    'admin.grace_period': t('eventGracePeriod'),
    'admin.flag_edit': t('eventFlagEdit'),
  }

  useEffect(() => {
    fetch('/api/admin/audit')
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((json) => setEvents(json.events))
      .catch(() => setError(t('error')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <div className="p-8 text-danger text-sm">{error}</div>
  if (!events) return <div className="p-8 text-text-sec text-sm">{t('loading')}</div>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-text-pri mb-1">{t('title')}</h1>
      <p className="text-text-sec text-sm mb-6">
        {t('subtitle')}
      </p>

      <Card>
        {events.length === 0 ? (
          <EmptyState icon="history" title={t('noEvents')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>{t('colAction')}</TableHeaderCell>
                <TableHeaderCell>{t('colOrg')}</TableHeaderCell>
                <TableHeaderCell>{t('colAdmin')}</TableHeaderCell>
                <TableHeaderCell>{t('colDetails')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('colWhen')}</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium text-text-pri">{EVENT_LABELS[e.event_type] ?? e.event_type}</TableCell>
                  <TableCell>{e.org_name ?? '—'}</TableCell>
                  <TableCell className="text-text-sec">{e.admin_name ?? '—'}</TableCell>
                  <TableCell className="text-text-mut font-mono truncate max-w-[240px]">
                    {e.metadata ? JSON.stringify(e.metadata) : '—'}
                  </TableCell>
                  <TableCell numeric className="text-text-sec">{new Date(e.created_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
