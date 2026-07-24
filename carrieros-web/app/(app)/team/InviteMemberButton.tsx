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
import { Button, Input, Modal, SegmentedControl } from '@/components/ui'
import PermissionPreview from '@/components/PermissionPreview'
import type { InvitableRole } from '@/lib/domain/role-permissions'

const ROLES = ['dispatcher', 'finance', 'owner'] as const

const labelCls = 'block text-xs font-medium text-text-sec mb-1.5'

export default function InviteMemberButton() {
  const router = useRouter()
  const t = useTranslations('team')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const empty = { email: '', phone: '', first_name: '', last_name: '', role: 'dispatcher' }
  const [form, setForm] = useState(empty)
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const [contactMethod, setContactMethod] = useState<'email' | 'phone'>('email')

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
    setContactMethod('email')
  }

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: contactMethod === 'email' ? form.email.trim() : undefined,
          phone: contactMethod === 'phone' ? form.phone.trim() : undefined,
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
      <Button onClick={() => setOpen(true)}>
        <span className="material-symbols-outlined text-[18px]">add</span>
        {t('inviteMember')}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={t('inviteMember')}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={close} disabled={loading}>
              {tCommon('cancel')}
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={loading || (contactMethod === 'email' ? !form.email : !form.phone)}
              loading={loading}
            >
              {loading ? t('sendingInvite') : t('sendInvite')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <SegmentedControl
              className="mb-2"
              items={[
                { value: 'email', label: t('inviteByEmail') },
                { value: 'phone', label: t('inviteByPhone') },
              ]}
              value={contactMethod}
              onChange={(v) => setContactMethod(v as 'email' | 'phone')}
            />
            {contactMethod === 'email' ? (
              <>
                <label className={labelCls}>{t('email')} *</label>
                <Input
                  type="email"
                  placeholder="dispatcher@example.com"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </>
            ) : (
              <>
                <label className={labelCls}>{t('phone')} *</label>
                <Input
                  type="tel"
                  placeholder="+15551234567"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
                <p className="text-xs text-text-mut mt-1.5">{t('phoneInviteNote')}</p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('firstName')}</label>
              <Input placeholder="Jane"
                value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('lastName')}</label>
              <Input placeholder="Doe"
                value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelCls}>{t('role')} *</label>
            <Input as="select" value={form.role} onChange={(e) => set('role', e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{t(`role_${r}` as never)}</option>
              ))}
            </Input>
            <p className="text-xs text-text-mut mt-1.5">{t(`roleHelp_${form.role}` as never)}</p>
          </div>

          <PermissionPreview role={form.role as InvitableRole} />

          <p className="text-xs text-text-mut">
            {t('driverRoleNote')}{' '}
            <Link href="/drivers" className="text-brand-orange hover:underline rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
              {t('driversHintLink')}
            </Link>
          </p>

          {error && (
            <div className="rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
              {error}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
