'use client'
// app/(app)/customers/[customer_number]/EditCustomerButton.tsx
// Opens a modal form pre-filled with the customer's current values and
// PATCHes /api/v1/customers/{id} (see app/api/v1/customers/[id]/route.ts).
// Mirrors app/(app)/customers/AddCustomerButton.tsx's fields, UI components,
// and success handling (close modal + router.refresh()). Web-only — mobile
// deliberately excludes customer editing (see
// carrieros-mobile/src/app/customers/[id].tsx).

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

export type EditCustomerInitial = {
  id: number
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  notes: string | null
}

export default function EditCustomerButton({ customer }: { customer: EditCustomerInitial }) {
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

  const toForm = (c: EditCustomerInitial) => ({
    name: c.name ?? '',
    contact_name: c.contact_name ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    address: c.address ?? '',
    city: c.city ?? '',
    state: c.state ?? '',
    zip: c.zip ?? '',
    country: c.country ?? '',
    notes: c.notes ?? '',
  })

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(toForm(customer))

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  function openModal() {
    setForm(toForm(customer))
    setError('')
    setOpen(true)
  }

  function close() {
    if (loading) return
    setOpen(false)
    setError('')
  }

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/customers/${customer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          contact_name: form.contact_name.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          city: form.city.trim() || null,
          state: form.state || null,
          zip: form.zip.trim() || null,
          country: form.country.trim() || null,
          notes: form.notes.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))

      setOpen(false)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openModal}>
        <span className="material-symbols-outlined text-[16px]">edit</span>
        {t('editCustomer')}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={t('editCustomer')}
        className="max-h-[90vh] overflow-y-auto"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={close} disabled={loading}>
              {tCommon('cancel')}
            </Button>
            <Button size="sm" onClick={submit} disabled={loading || !form.name.trim()} loading={loading}>
              {loading ? t('saving') : tCommon('save')}
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
            <label className={labelCls}>{t('country')}</label>
            <Input placeholder="US"
              value={form.country} onChange={e => set('country', e.target.value)} />
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
