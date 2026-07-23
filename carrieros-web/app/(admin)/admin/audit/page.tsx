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
import { Card, Table, TableHeaderCell, TableRow, TableCell, EmptyState } from '@/components/ui'

interface AuditEvent {
  id: number
  event_type: string
  metadata: Record<string, unknown> | null
  created_at: string
  org_name: string | null
  admin_name: string | null
}

const EVENT_LABELS: Record<string, string> = {
  'admin.note_add': 'Note added',
  'admin.impersonate': 'Impersonated owner',
  'admin.change_tier': 'Changed tier',
  'admin.extend_trial': 'Extended trial',
  'admin.grace_period': 'Set grace period',
  'admin.flag_edit': 'Edited feature flag',
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/admin/audit')
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((json) => setEvents(json.events))
      .catch(() => setError('Could not load audit events.'))
  }, [])

  if (error) return <div className="p-8 text-danger text-sm">{error}</div>
  if (!events) return <div className="p-8 text-text-sec text-sm">Loading…</div>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-text-pri mb-1">Audit &amp; Activity</h1>
      <p className="text-text-sec text-sm mb-6">
        Admin-initiated actions only — not a full cross-tenant audit trail (no login/load/billing event logging exists yet).
      </p>

      <Card>
        {events.length === 0 ? (
          <EmptyState icon="history" title="No admin actions logged yet." />
        ) : (
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>Action</TableHeaderCell>
                <TableHeaderCell>Org</TableHeaderCell>
                <TableHeaderCell>Admin</TableHeaderCell>
                <TableHeaderCell>Details</TableHeaderCell>
                <TableHeaderCell numeric>When</TableHeaderCell>
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
