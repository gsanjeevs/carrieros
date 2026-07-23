'use client'
// app/(app)/team/MemberActions.tsx
// Per-row role change + remove. Only rendered for OTHER members with a
// back-office role — never for the signed-in user (self-role-change is a
// privilege-escalation path) and never for drivers/solos, whose accounts are
// managed on /drivers. The API route re-checks all of that; this component
// only decides what is worth showing.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Input, Modal } from '@/components/ui'

const ROLES = ['dispatcher', 'finance', 'owner'] as const

export default function MemberActions({
  memberId,
  role,
  name,
}: {
  memberId: string
  role: string
  name: string
}) {
  const router = useRouter()
  const t = useTranslations('team')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  async function call(init: RequestInit) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/team/${memberId}`, init)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(friendly(json.error_code))
        return false
      }
      router.refresh()
      return true
    } catch {
      setError(tCommon('somethingWentWrong'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const changeRole = (next: string) =>
    call({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: next }),
    })

  const remove = async () => {
    const ok = await call({ method: 'DELETE' })
    if (ok) setConfirming(false)
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center justify-end gap-2">
        <Input
          as="select"
          aria-label={t('changeRole')}
          disabled={busy}
          value={role}
          onChange={(e) => changeRole(e.target.value)}
          className="w-auto"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{t(`role_${r}` as never)}</option>
          ))}
        </Input>
        <button
          onClick={() => { setError(''); setConfirming(true) }}
          disabled={busy}
          className="text-text-sec hover:text-danger disabled:opacity-40 transition rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
          title={t('remove')}
        >
          <span className="material-symbols-outlined text-[18px] leading-none align-middle">person_remove</span>
        </button>
      </div>

      {error && <p className="text-danger text-xs max-w-[16rem] text-right">{error}</p>}

      <Modal
        open={confirming}
        onClose={() => { if (!busy) { setConfirming(false); setError('') } }}
        size="sm"
        title={t('removeTitle')}
        variant="confirm-destructive"
        onConfirm={remove}
        confirmLabel={busy ? tCommon('loading') : t('remove')}
      >
        <p className="text-text-sec text-sm">{t('removeConfirm', { name })}</p>
        {error && (
          <div className="mt-4 rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
            {error}
          </div>
        )}
      </Modal>
    </div>
  )
}
