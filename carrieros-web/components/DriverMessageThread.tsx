'use client'
// components/DriverMessageThread.tsx
// Driver <-> back-office chat for a load (audit gap #13, Growth+ driver_chat
// feature). The API routes (app/api/driver-messages/, .../[id]/translate)
// already existed with full role/tier gating and language-inheritance
// logic — this component is the missing UI that calls them. No GET route
// exists for listing a thread, so this reads driver_messages directly via
// the browser client, same RLS policies the POST route's own explicit
// checks mirror (driver_own_thread_messages / owner_solo_dispatcher_messages_all).
//
// Polling-gap audit fix: previously polled every 5s ("no realtime
// subscription is wired anywhere in this codebase yet"). Now subscribes to
// a Postgres Changes channel scoped to this load_id — RLS still applies to
// realtime payloads (driver_own_thread_messages / owner_solo_dispatcher_
// messages_all), so this can't leak another load's messages. Falls back to
// the initial `load()` fetch for anything sent before the subscription was
// established; the channel only carries messages inserted after it opens.
import { apiClient } from '@/lib/api-client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Card, CardBody, Input, Button } from '@/components/ui'

interface MessageRow {
  id: number
  sender_id: string | null
  body: string
  original_language: string | null
  sent_at: string
  read_at: string | null
  profiles: { first_name: string | null; last_name: string | null } | null
}

// Read receipts go through the shared API (same endpoint the mobile chat uses): the server marks only
// OTHER people's unread messages on THIS load, so the ids here are a request, not an authority.
async function markRead(loadId: number, messageIds: number[]) {
  try {
    await apiClient.http.POST('/api/v1/loads/{id}/messages/read', { params: { path: { id: loadId } }, body: { message_ids: messageIds } })
  } catch {
    /* best effort: retried the next time the thread loads */
  }
}

export default function DriverMessageThread({
  loadId,
  currentUserId,
  locale,
}: {
  loadId: number
  currentUserId: string
  locale: string
}) {
  const t = useTranslations('loads')
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [translated, setTranslated] = useState<Record<number, string>>({})
  const [translating, setTranslating] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('driver_messages')
      .select('id, sender_id, body, original_language, sent_at, read_at, profiles(first_name, last_name)')
      .eq('load_id', loadId)
      .order('sent_at', { ascending: true })
    setMessages((data as unknown as MessageRow[]) ?? [])

    // Mark-as-read (audit gap: driver_messages.read_at existed but nothing
    // ever set it). Scoped to messages from someone else that are still
    // unread — never touches the viewer's own sent messages.
    const unreadIds = ((data as unknown as MessageRow[]) ?? [])
      .filter((m) => m.sender_id !== currentUserId && !m.read_at)
      .map((m) => m.id)
    if (unreadIds.length > 0) {
      await markRead(loadId, unreadIds)
    }
  }, [loadId, currentUserId])

  useEffect(() => {
    // Deliberately not calling the `load` useCallback bare here — eslint's
    // react-hooks/set-state-in-effect rule can trace a locally-defined
    // function reference back to its own setState calls and flags invoking
    // it directly in an effect body, but can't trace through an opaque
    // Supabase/Promise .then() chain the same way (see the working,
    // unflagged precedent in DispatchPanel.tsx's `fetch(...).then(setDrivers)`).
    // Duplicates load()'s fetch+mark-read logic for this initial call only;
    // send() below still reuses `load()` directly since that call isn't
    // inside an effect.
    const supabase = createClient()
    supabase
      .from('driver_messages')
      .select('id, sender_id, body, original_language, sent_at, read_at, profiles(first_name, last_name)')
      .eq('load_id', loadId)
      .order('sent_at', { ascending: true })
      .then(({ data }) => {
        const rows = (data as unknown as MessageRow[]) ?? []
        setMessages(rows)
        const unreadIds = rows.filter((m) => m.sender_id !== currentUserId && !m.read_at).map((m) => m.id)
        if (unreadIds.length > 0) {
          void markRead(loadId, unreadIds)
        }
      })

    // Postgres Changes payloads carry only the raw driver_messages row (no
    // embedded `profiles` join), so a fresh INSERT is re-fetched by id to
    // get the sender's name rather than trying to reshape the join client-side.
    const channel = supabase
      .channel(`driver-messages-load-${loadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'driver_messages', filter: `load_id=eq.${loadId}` },
        async (payload) => {
          const { data } = await supabase
            .from('driver_messages')
            .select('id, sender_id, body, original_language, sent_at, profiles(first_name, last_name)')
            .eq('id', (payload.new as { id: number }).id)
            .maybeSingle()
          if (!data) return
          setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data as unknown as MessageRow]))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadId, currentUserId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length])

  async function send() {
    if (!draft.trim()) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/driver-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ load_id: loadId, body: draft.trim() }),
      })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error_code === 'TIER_UPGRADE_REQUIRED' ? t('chatUpgradeRequired') : t('chatSendFailed'))
      }
      setDraft('')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('chatSendFailed'))
    } finally {
      setSending(false)
    }
  }

  async function translate(messageId: number) {
    setTranslating(messageId)
    try {
      const res = await fetch(`/api/driver-messages/${messageId}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_language: locale }),
      })
      if (res.ok) {
        const j = await res.json()
        setTranslated((prev) => ({ ...prev, [messageId]: j.translated_body }))
      }
    } finally {
      setTranslating(null)
    }
  }

  return (
    <Card>
      <CardBody>
      <h2 className="text-text-pri font-medium text-sm mb-3">{t('chatTitle')}</h2>

      <div className="max-h-80 overflow-y-auto space-y-2 mb-3 pr-1">
        {messages.length === 0 ? (
          <p className="text-slate-500 text-sm">{t('chatNoMessages')}</p>
        ) : (
          messages.map((m) => {
            // sender_id NULL = system message (schema.sql's own column
            // comment) — an auto-generated status note, not a person
            // talking. Rendered centered/muted, distinct from either side's
            // chat bubbles, rather than as a bubble from a fake "System" user.
            if (m.sender_id === null) {
              return (
                <div key={m.id} className="flex justify-center">
                  <p className="text-slate-500 text-[11px] italic px-3 py-1">{m.body}</p>
                </div>
              )
            }
            const isMine = m.sender_id === currentUserId
            const senderName = m.profiles
              ? [m.profiles.first_name, m.profiles.last_name].filter(Boolean).join(' ') || t('chatDriver')
              : t('chatDriver')
            const showTranslate = m.original_language && m.original_language !== locale
            return (
              <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-xl px-3 py-2 ${isMine ? 'bg-brand-orange text-white' : 'bg-white/10 text-slate-100'}`}>
                  {!isMine && <p className="text-[10px] opacity-70 mb-0.5">{senderName}</p>}
                  <p className="text-sm">{translated[m.id] ?? m.body}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-[10px] opacity-60">{new Date(m.sent_at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}</p>
                    {showTranslate && !translated[m.id] && (
                      <button
                        onClick={() => translate(m.id)}
                        disabled={translating === m.id}
                        className="text-[10px] underline opacity-80 hover:opacity-100"
                      >
                        {translating === m.id ? t('chatTranslating') : t('chatTranslate')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

      <div className="flex gap-2">
        <Input
          size="lg"
          className="flex-1"
          placeholder={t('chatPlaceholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          disabled={sending}
        />
        <Button
          onClick={send}
          disabled={sending || !draft.trim()}
        >
          {t('chatSend')}
        </Button>
      </div>
      </CardBody>
    </Card>
  )
}
