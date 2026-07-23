'use client'
// app/(app)/customers/AddCustomerButton.tsx
// Opens a modal form that calls POST /api/customers (delegates to the
// create_customer_org RPC — see app/api/customers/route.ts), then refreshes
// the customer list with a success banner (?created=<name>).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Input, Modal } from '@/components/ui'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]

const labelCls = 'block text-xs font-medium text-text-sec mb-1.5'

export default function AddCustomerButton({ variant }: { variant?: 'empty' }) {
  const router = useRouter()
  const t = useTranslations('customers')
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

  const emptyForm = {
    name: '',
    contact_name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    notes: '',
  }
  const [form, setForm] = useState(emptyForm)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  function close() {
    if (loading) return
    setOpen(false)
    setError('')
    setForm(emptyForm)
  }

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          contact_name: form.contact_name.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          address: form.address.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state || undefined,
          zip: form.zip.trim() || undefined,
          notes: form.notes.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))

      setOpen(false)
      setForm(emptyForm)
      router.push(`/customers?created=${encodeURIComponent(json.name)}`)
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
          {t('addFirstCustomer')}
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <span className="material-symbols-outlined text-[18px]">add</span>
          {t('addCustomer')}
        </Button>
      )}

      <Modal
        open={open}
        onClose={close}
        title={t('addCustomer')}
        className="max-h-[90vh] overflow-y-auto"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={close} disabled={loading}>
              {tCommon('cancel')}
            </Button>
            <Button size="sm" onClick={submit} disabled={loading || !form.name.trim()} loading={loading}>
              {loading ? t('adding') : t('addCustomer')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>{t('companyName')} *</label>
            <Input
              placeholder="Fast Freight LLC"
              value={form.name}
              onChange={e => set('name', e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls}>{t('contactName')}</label>
            <Input placeholder="Mike Paulson"
              value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('phone')}</label>
              <Input placeholder="(555) 123-4567"
                value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('email')}</label>
              <Input type="email" placeholder="dispatch@example.com"
                value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelCls}>{t('address')}</label>
            <Input placeholder="123 Main St"
              value={form.address} onChange={e => set('address', e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>{t('city')}</label>
              <Input placeholder="Chicago"
                value={form.city} onChange={e => set('city', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('state')}</label>
              <Input as="select" value={form.state} onChange={e => set('state', e.target.value)}>
                <option value="">{tCommon('selectPlaceholder')}</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </Input>
            </div>
            <div>
              <label className={labelCls}>{t('zip')}</label>
              <Input placeholder="60601"
                value={form.zip} onChange={e => set('zip', e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelCls}>{t('notes')}</label>
            <Input as="textarea" className="resize-none" rows={2} placeholder={t('notesPlaceholder')}
              value={form.notes} onChange={e => set('notes', e.target.value)} />
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
