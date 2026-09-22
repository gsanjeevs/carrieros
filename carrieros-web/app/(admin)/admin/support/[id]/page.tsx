'use client'
// app/(admin)/admin/support/[id]/page.tsx — carrieros_support ticket detail/reply for ShipmentX
// staff (decisions.md T16). Reached from the Triage Queue's "Reply Now" link (admin/page.tsx) rather
// than from a second, separate list screen — per T16's explicit instruction not to build one.
// Client-fetched from GET/PATCH /api/admin/support-tickets/[id] + POST .../reply, same pattern
// app/(admin)/admin/orgs/[org_id]/page.tsx already uses for its notes thread.
import { useEffect, useState, use as usePromise } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardHeader, CardBody, StatusBadge, Button, Input } from '@/components/ui'

interface Ticket {
  id: number
  carrier_org_id: number
  submitter_role: string
  submitter_tier: string | null
  category: string
  related_load_number: string | null
  body: string
  queue: string
  status: string
  ai_confidence: number | null
  created_at: string
  organizations?: { name: string } | null
}

interface Message {
  id: number
  sender_id: string | null
  is_ai_generated: boolean
  body: string
  created_at: string
}

export default function AdminSupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params)
  const t = useTranslations('admin.supportTickets')

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [error, setError] = useState('')
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  async function load() {
    try {
      const res = await fetch(`/api/admin/support-tickets/${id}`)
      if (!res.ok) throw new Error()
      const json = await res.json()
      setTicket(json.ticket)
      setMessages(json.messages)
    } catch {
      setError(t('error'))
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function sendReply() {
    if (!reply.trim()) return
    setSending(true)
    await fetch(`/api/admin/support-tickets/${id}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: reply.trim() }),
    })
    setReply('')
    setSending(false)
    load()
  }

  async function setStatus(status: 'resolved' | 'closed') {
    setUpdatingStatus(true)
    await fetch(`/api/admin/support-tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setUpdatingStatus(false)
    load()
  }

  if (error) return <div className="p-8 text-danger text-sm">{error}</div>
  if (!ticket) return <div className="p-8 text-text-sec text-sm">{t('loading')}</div>

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <Link href="/admin" className="text-text-sec text-sm hover:text-text-pri mb-4 inline-block">
        ← {t('backToTriage')}
      </Link>

      <Card>
        <CardHeader>
          <h2 className="text-text-pri font-medium text-sm">{t('title')}</h2>
          <StatusBadge variant={ticket.status === 'open' ? 'warning' : 'success'} size="sm">{ticket.status}</StatusBadge>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-3 text-sm mb-4">
            <div>
              <p className="text-text-mut text-xs">{t('orgLabel')}</p>
              <p className="text-text-pri">{ticket.organizations?.name ?? `Org #${ticket.carrier_org_id}`}</p>
            </div>
            <div>
              <p className="text-text-mut text-xs">{t('submitterLabel')}</p>
              <p className="text-text-pri">{ticket.submitter_role}{ticket.submitter_tier ? ` · ${ticket.submitter_tier}` : ''}</p>
            </div>
            <div>
              <p className="text-text-mut text-xs">{t('categoryLabel')}</p>
              <p className="text-text-pri">{ticket.category}{ticket.related_load_number ? ` (${ticket.related_load_number})` : ''}</p>
            </div>
            {ticket.ai_confidence !== null && (
              <div>
                <p className="text-text-mut text-xs">{t('confidenceLabel')}</p>
                <p className="text-text-pri">{Math.round(ticket.ai_confidence * 100)}%</p>
              </div>
            )}
          </div>

          <p className="text-text-sec text-sm whitespace-pre-wrap bg-surface-subtle rounded-lg px-3 py-2 mb-4">{ticket.body}</p>

          <div className="space-y-2 mb-3 max-h-96 overflow-y-auto">
            {messages.map((m) => (
              <div key={m.id} className={`rounded-lg px-3 py-2 ${m.is_ai_generated ? 'bg-info/10' : 'bg-surface-subtle'}`}>
                {m.is_ai_generated && <p className="text-info text-[10px] font-semibold mb-0.5">{t('aiAnswerLabel')}</p>}
                <p className="text-text-sec text-sm whitespace-pre-wrap">{m.body}</p>
                <p className="text-text-mut text-[10px] mt-1">{new Date(m.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>

          <Input
            as="textarea"
            rows={3}
            placeholder={t('replyPlaceholder')}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            className="resize-none mb-2"
          />
          <div className="flex items-center gap-2">
            <Button onClick={sendReply} disabled={!reply.trim()} loading={sending}>{t('sendReply')}</Button>
            <Button variant="secondary" onClick={() => setStatus('resolved')} loading={updatingStatus} disabled={ticket.status !== 'open'}>
              {t('markResolved')}
            </Button>
            <Button variant="ghost" onClick={() => setStatus('closed')} loading={updatingStatus} disabled={ticket.status === 'closed'}>
              {t('markClosed')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
