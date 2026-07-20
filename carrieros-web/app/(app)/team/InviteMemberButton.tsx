'use client'
// app/(app)/team/InviteMemberButton.tsx
// Modal invite form for back-office roles — same shape as
// app/(app)/drivers/InviteDriverButton.tsx. The role picker deliberately
// offers only dispatcher / finance / owner: a driver invite also has to
// create a `drivers` row + driver_number, which /drivers already does, so
// this form links there instead of duplicating that flow.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

const ROLES = ['dispatcher', 'finance', 'owner'] as const

const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/40 transition'
const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5'

export default function InviteMemberButton() {
  const router = useRouter()
  const t = useTranslations('team')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const empty = { email: '', first_name: '', last_name: '', role: 'dispatcher' }
  const [form, setForm] = useState(empty)
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  // `errors` messages are keyed by error_code — never render a raw API string.
  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  function close() {
    if (loading) return
    setOpen(false)
    setError('')
    setForm(empty)
  }

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim(),
          first_name: form.first_name.trim() || undefined,
          last_name: form.last_name.trim() || undefined,
          role: form.role,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))

      setOpen(false)
      setForm(empty)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
      >
        <span className="material-symbols-outlined text-[18px]">add</span>
        {t('inviteMember')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-md bg-[#0f1923] border border-white/10 rounded-2xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">{t('inviteMember')}</h2>
              <button onClick={close} className="text-slate-500 hover:text-white transition rounded focus:outline-none focus:ring-2 focus:ring-[#f97316]/50">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelCls}>{t('email')} *</label>
                <input
                  className={inputCls}
                  type="email"
                  placeholder="dispatcher@example.com"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('firstName')}</label>
                  <input className={inputCls} placeholder="Jane"
                    value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t('lastName')}</label>
                  <input className={inputCls} placeholder="Doe"
                    value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
                </div>
              </div>

              <div>
                <label className={labelCls}>{t('role')} *</label>
                <select className={inputCls} value={form.role} onChange={(e) => set('role', e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{t(`role_${r}` as never)}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1.5">{t(`roleHelp_${form.role}` as never)}</p>
              </div>

              <p className="text-xs text-slate-500">
                {t('driverRoleNote')}{' '}
                <Link href="/drivers" className="text-[#f97316] hover:underline rounded focus:outline-none focus:ring-2 focus:ring-[#f97316]/50">
                  {t('driversHintLink')}
                </Link>
              </p>

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-3 mt-2">
                <button
                  onClick={close}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white font-medium rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
                >
                  {tCommon('cancel')}
                </button>
                <button
                  onClick={submit}
                  disabled={loading || !form.email}
                  className="flex-2 flex-grow py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
                >
                  {loading ? t('sendingInvite') : t('sendInvite')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
