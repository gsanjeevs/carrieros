'use client'
// app/(app)/support/[id]/page.tsx — a submitter's own ticket thread + reply + "still need help?"
// escalation (decisions.md T16: an ai_resolved ticket is never a dead end). Org_support staff
// replying to their own org's queue also lands here when they follow a link from their staff console
// (app/(app)/settings/support-desk) — same route, RLS decides what each caller can see/do.
import { useEffect, useState, use as usePromise } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardBody, Button, Input, StatusBadge } from '@/components/ui'

interface Ticket {
  id: number
  category: string
  body: string
  queue: 'carrieros_support' | 'org_support' | 'ai_resolved'
  fallback_queue: 'carrieros_support' | 'org_support' | null
  status: 'open' | 'resolved' | 'closed'
  created_at: string
}

interface Message {
  id: number
  sender_id: string | null
  is_ai_generated: boolean
  body: string
  created_at: string
}

export default function SupportTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params)
  const t = useTranslations('support')

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [error, setError] = useState('')
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [escalating, setEscalating] = useState(false)
  const [escalated, setEscalated] = useState(false)

  async function load() {
    try {
      const res = await fetch(`/api/support/tickets/${id}`)
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
    await fetch(`/api/support/tickets/${id}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: reply.trim() }),
    })
    setReply('')
    setSending(false)
    load()
  }

  async function escalate() {
    setEscalating(true)
    const res = await fetch(`/api/support/tickets/${id}/escalate`, { method: 'POST' })
    setEscalating(false)
    if (res.ok) {
      setEscalated(true)
      load()
    }
  }

  if (error) return <div className="p-8 text-danger text-sm">{error}</div>
  if (!ticket) return <div className="p-8 text-text-sec text-sm">{t('loading')}</div>

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <Link href="/support" className="text-text-sec text-sm hover:text-text-pri mb-4 inline-block">
        ← {t('backToTickets')}
      </Link>

      <Card>
        <CardBody>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-text-pri text-lg font-semibold">{t(`categories.${ticket.category}`)}</h1>
            <StatusBadge variant={ticket.status === 'open' ? 'warning' : ticket.status === 'resolved' ? 'success' : 'neutral'} size="sm">
              {ticket.status === 'open' ? t('statusOpen') : ticket.status === 'resolved' ? t('statusResolved') : t('statusClosed')}
            </StatusBadge>
          </div>

          <p className="text-text-sec text-sm whitespace-pre-wrap bg-surface-subtle rounded-lg px-3 py-2 mb-4">{ticket.body}</p>

          <div className="space-y-2 mb-4">
            {messages.map((m) => (
              <div key={m.id} className={`rounded-lg px-3 py-2 ${m.is_ai_generated ? 'bg-info/10' : 'bg-surface-subtle'}`}>
                {m.is_ai_generated && <p className="text-info text-[10px] font-semibold mb-0.5">{t('aiAnswerLabel')}</p>}
                <p className="text-text-sec text-sm whitespace-pre-wrap">{m.body}</p>
                <p className="text-text-mut text-[10px] mt-1">{new Date(m.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>

          {ticket.queue === 'ai_resolved' && !escalated && (
            <div className="mb-4 flex items-center justify-between bg-surface-subtle rounded-lg px-3 py-2.5">
              <span className="text-text-sec text-sm">{t('stillNeedHelp')}</span>
              <Button variant="secondary" size="sm" onClick={escalate} loading={escalating}>{t('escalate')}</Button>
            </div>
          )}
          {escalated && <p className="text-success text-sm mb-4">{t('escalated')}</p>}

          {ticket.status !== 'closed' && ticket.queue !== 'ai_resolved' && (
            <>
              <Input
                as="textarea"
                rows={3}
                placeholder={t('replyPlaceholder')}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                className="resize-none mb-2"
              />
              <Button onClick={sendReply} disabled={!reply.trim()} loading={sending}>{t('sendReply')}</Button>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
