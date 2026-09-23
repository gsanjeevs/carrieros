'use client'
// app/(app)/settings/support-desk/SupportDeskConsole.tsx — org_support_manage staff's own list of
// their org's org_support-queue tickets (decisions.md T16). Fetches GET /api/support/org-queue
// (RLS-filtered to the caller's own org); reply happens on the shared app/(app)/support/[id] detail
// page (the same RLS policies that gate this list also gate that route for staff, so no separate
// admin-style route was needed for reading/replying — only this list view and the inline
// resolve/close action below are specific to the staff console).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, StatusBadge, Button } from '@/components/ui'

interface Ticket {
  id: number
  submitter_role: string
  category: string
  body: string
  status: 'open' | 'resolved' | 'closed'
  created_at: string
}

export default function SupportDeskConsole() {
  const t = useTranslations('supportDesk')
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/support/org-queue')
      if (!res.ok) throw new Error()
      setTickets((await res.json()).tickets)
    } catch {
      setError(t('error'))
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function setStatus(id: number, status: 'resolved' | 'closed') {
    setBusyId(id)
    await fetch(`/api/support/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setBusyId(null)
    load()
  }

  if (error) return <p className="text-danger text-sm">{error}</p>
  if (tickets === null) return <p className="text-text-sec text-sm">{t('loading')}</p>
  if (tickets.length === 0) return <p className="text-text-mut text-sm">{t('noTickets')}</p>

  return (
    <div className="space-y-2">
      {tickets.map((tk) => (
        <Card key={tk.id} className="px-4 py-3 flex items-center justify-between gap-3">
          <Link href={`/support/${tk.id}`} className="min-w-0 flex-1">
            <p className="text-text-pri text-sm truncate">{tk.category} · {t('submitterLabel')}: {tk.submitter_role}</p>
            <p className="text-text-mut text-xs truncate">{tk.body}</p>
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge variant={tk.status === 'open' ? 'warning' : tk.status === 'resolved' ? 'success' : 'neutral'} size="sm">
              {tk.status}
            </StatusBadge>
            {tk.status === 'open' && (
              <Button variant="secondary" size="sm" onClick={() => setStatus(tk.id, 'resolved')} loading={busyId === tk.id}>
                {t('markResolved')}
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}
