'use client'
// app/(app)/drivers/InviteDriverButton.tsx
// Opens a modal form that calls POST /api/drivers/invite, then refreshes
// the drivers list with a success banner (?invited=<driver_number>).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Input, Modal } from '@/components/ui'

type Vehicle = {
  id: number
  vehicle_number: string | null
  nickname: string | null
}

const labelCls = 'block text-xs font-medium text-text-sec mb-1.5'

export default function InviteDriverButton({ vehicles, variant }: { vehicles: Vehicle[]; variant?: 'empty' }) {
  const router = useRouter()
  const t = useTranslations('drivers')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  // `errors` messages are keyed by error_code — never render a raw API string.
  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    email: '',
    phone: '',
    first_name: '',
    last_name: '',
    default_vehicle_id: '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  function close() {
    if (loading) return
    setOpen(false)
    setError('')
    setForm({ email: '', phone: '', first_name: '', last_name: '', default_vehicle_id: '' })
  }

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/drivers/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          first_name: form.first_name.trim() || undefined,
          last_name: form.last_name.trim() || undefined,
          default_vehicle_id: form.default_vehicle_id ? Number(form.default_vehicle_id) : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))

      setOpen(false)
      setForm({ email: '', phone: '', first_name: '', last_name: '', default_vehicle_id: '' })
      router.push(`/drivers?invited=${json.driver_number}`)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {variant === 'empty' ? (
        <Button onClick={() => setOpen(true)} className="mt-4">
          <span className="material-symbols-outlined text-[16px]">add</span>
          {t('inviteFirstDriver')}
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <span className="material-symbols-outlined text-[18px]">add</span>
          {t('inviteDriver')}
        </Button>
      )}

      <Modal
        open={open}
        onClose={close}
        title={t('inviteDriver')}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={close} disabled={loading}>
              {tCommon('cancel')}
            </Button>
            <Button size="sm" onClick={submit} disabled={loading || !form.email} loading={loading}>
              {loading ? t('sendingInvite') : t('sendInvite')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>{t('email')} *</label>
            <Input
              type="email"
              placeholder="driver@example.com"
              value={form.email}
              onChange={e => set('email', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('firstName')}</label>
              <Input placeholder="John"
                value={form.first_name} onChange={e => set('first_name', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('lastName')}</label>
              <Input placeholder="Smith"
                value={form.last_name} onChange={e => set('last_name', e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelCls}>{t('phone')}</label>
            <Input placeholder="(555) 123-4567"
              value={form.phone} onChange={e => set('phone', e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>{t('truckOptional')}</label>
            <Input as="select" value={form.default_vehicle_id} onChange={e => set('default_vehicle_id', e.target.value)}>
              <option value="">{t('noDefaultTruck')}</option>
              {vehicles.map(vehicle => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.vehicle_number}{vehicle.nickname ? ` — ${vehicle.nickname}` : ''}
                </option>
              ))}
            </Input>
          </div>

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
