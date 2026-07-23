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
// No realtime subscription is wired anywhere in this codebase yet — kept
// consistent with that by polling on an interval instead of introducing
// a new pattern for just this one screen.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

const POLL_MS = 5000

interface MessageRow {
  id: number
  sender_id: string | null
  body: string
  original_language: string | null
  sent_at: string
  profiles: { first_name: string | null; last_name: string | null } | null
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
      .select('id, sender_id, body, original_language, sent_at, profiles(first_name, last_name)')
      .eq('load_id', loadId)
      .order('sent_at', { ascending: true })
    setMessages((data as unknown as MessageRow[]) ?? [])
  }, [loadId])

  useEffect(() => {
    load()
    const interval = setInterval(load, POLL_MS)
    return () => clearInterval(interval)
  }, [load])

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
    <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
      <h2 className="text-white font-medium text-sm mb-3">{t('chatTitle')}</h2>

      <div className="max-h-80 overflow-y-auto space-y-2 mb-3 pr-1">
        {messages.length === 0 ? (
          <p className="text-slate-500 text-sm">{t('chatNoMessages')}</p>
        ) : (
          messages.map((m) => {
            const isMine = m.sender_id === currentUserId
            const senderName = m.profiles
              ? [m.profiles.first_name, m.profiles.last_name].filter(Boolean).join(' ') || t('chatDriver')
              : t('chatSystem')
            const showTranslate = m.original_language && m.original_language !== locale
            return (
              <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-xl px-3 py-2 ${isMine ? 'bg-[#f97316] text-white' : 'bg-white/10 text-slate-100'}`}>
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
        <input
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#f97316] transition"
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
        <button
          onClick={send}
          disabled={sending || !draft.trim()}
          className="px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition"
        >
          {t('chatSend')}
        </button>
      </div>
    </div>
  )
}
