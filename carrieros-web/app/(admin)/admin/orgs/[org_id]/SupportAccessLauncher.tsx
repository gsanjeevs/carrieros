'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Input } from '@/components/ui'

export default function SupportAccessLauncher({
  orgId,
  userId,
}: {
  orgId: number
  userId: string
}) {
  const router = useRouter()
  const t = useTranslations('admin.supportAccess')
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [ticketId, setTicketId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/orgs/${orgId}/support-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_user_id: userId,
          reason,
          ticket_id: ticketId.trim() || null,
        }),
      })
      if (!response.ok) throw new Error(response.status === 400 ? t('inputError') : t('startFailed'))
      const data = await response.json()
      router.push(`/admin/support-sessions/${data.session.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('startFailed'))
      setBusy(false)
    }
  }

  if (!open) {
    return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{t('start')}</Button>
  }

  return (
    <div className="w-full rounded-lg border border-divider-ui bg-surface-subtle p-3 space-y-2">
      <p className="text-xs text-text-sec">{t('readOnlyNotice')}</p>
      <label className="block text-xs text-text-sec">
        {t('reasonLabel')}
        <Input as="textarea" rows={2} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder={t('reasonPlaceholder')} className="mt-1 resize-y" />
      </label>
      <label className="block text-xs text-text-sec">
        {t('ticketLabel')}
        <Input inputMode="numeric" value={ticketId} onChange={event => setTicketId(event.target.value)} placeholder={t('ticketPlaceholder')} className="mt-1" />
      </label>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void start()} loading={busy} disabled={reason.trim().length < 10 || busy}>{t('confirmStart')}</Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>{t('cancel')}</Button>
      </div>
    </div>
  )
}
