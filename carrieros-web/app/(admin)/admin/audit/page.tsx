'use client'
// app/(admin)/admin/audit/page.tsx — Audit & Activity (audit gap #14).
// GET /api/admin/audit — see that route's own header comment on scope:
// admin_events only logs admin-INITIATED actions (notes, tier/trial/
// grace-period changes, flag overrides, impersonation), not a full
// cross-tenant audit trail (no login/load/billing event logging exists).
import { useEffect, useState } from 'react'

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

  if (error) return <div className="p-8 text-red-400 text-sm">{error}</div>
  if (!events) return <div className="p-8 text-slate-400 text-sm">Loading…</div>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white mb-1">Audit &amp; Activity</h1>
      <p className="text-slate-400 text-sm mb-6">
        Admin-initiated actions only — not a full cross-tenant audit trail (no login/load/billing event logging exists yet).
      </p>

      <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
        {events.length === 0 ? (
          <div className="px-5 py-16 text-center text-slate-500 text-sm">No admin actions logged yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Action</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Org</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Admin</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Details</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-white/[0.07] transition-colors duration-150">
                  <td className="px-5 py-3 text-white font-medium">{EVENT_LABELS[e.event_type] ?? e.event_type}</td>
                  <td className="px-4 py-3 text-slate-300">{e.org_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{e.admin_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs font-mono truncate max-w-[240px]">
                    {e.metadata ? JSON.stringify(e.metadata) : '—'}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-400 text-xs">{new Date(e.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
