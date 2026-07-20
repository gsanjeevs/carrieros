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
        <select
          aria-label={t('changeRole')}
          disabled={busy}
          value={role}
          onChange={(e) => changeRole(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/40 disabled:opacity-40"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{t(`role_${r}` as never)}</option>
          ))}
        </select>
        <button
          onClick={() => { setError(''); setConfirming(true) }}
          disabled={busy}
          className="text-slate-500 hover:text-red-400 disabled:opacity-40 transition rounded focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
          title={t('remove')}
        >
          <span className="material-symbols-outlined text-[18px] leading-none align-middle">person_remove</span>
        </button>
      </div>

      {error && <p className="text-red-400 text-xs max-w-[16rem] text-right">{error}</p>}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm bg-[#0f1923] border border-white/10 rounded-2xl p-6 text-left shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
            <h2 className="text-white font-semibold text-base mb-2">{t('removeTitle')}</h2>
            <p className="text-slate-400 text-sm mb-5">{t('removeConfirm', { name })}</p>
            {error && (
              <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { if (!busy) { setConfirming(false); setError('') } }}
                disabled={busy}
                className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white font-medium rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
              >
                {tCommon('cancel')}
              </button>
              <button
                onClick={remove}
                disabled={busy}
                className="flex-1 py-2.5 bg-red-500/90 hover:bg-red-500 disabled:opacity-40 text-white font-semibold rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
              >
                {busy ? tCommon('loading') : t('remove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
