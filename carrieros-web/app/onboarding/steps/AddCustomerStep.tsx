'use client'
// app/onboarding/steps/AddCustomerStep.tsx
// Thin wrapper around POST /api/customers -> create_customer_org() RPC —
// zero backend changes. Optional/skippable, same reasoning as the vehicle
// step: a carrier's first customer relationship may not exist yet.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button, Callout, Field, Input } from '@/components/ui'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]

export default function AddCustomerStep({ onNext }: { onNext: (added: boolean) => void }) {
  const t = useTranslations('onboarding')
  const tCustomers = useTranslations('customers')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '', contact_name: '', phone: '', email: '',
    address: '', city: '', state: '', zip: '',
  })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

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
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))
      onNext(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-white font-semibold text-lg mb-1">{t('stepCustomerTitle')}</h2>
      <p className="text-slate-400 text-sm mb-4">{t('stepCustomerSubtitle')}</p>

      <Field label={t('customerName')}>
        <Input size="lg" placeholder="Pacific Produce Distributors"
          value={form.name} onChange={e => set('name', e.target.value)} />
      </Field>

      <Field label={t('customerContactName')}>
        <Input size="lg" placeholder="Jane Doe"
          value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('customerPhone')}>
          <Input size="lg" placeholder="(555) 123-4567"
            value={form.phone} onChange={e => set('phone', e.target.value)} />
        </Field>
        <Field label={t('customerEmail')}>
          <Input size="lg" placeholder="dispatch@example.com" type="email"
            value={form.email} onChange={e => set('email', e.target.value)} />
        </Field>
      </div>

      <Field label={tCustomers('address')}>
        <Input size="lg" placeholder="800 Market St"
          value={form.address} onChange={e => set('address', e.target.value)} />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label={tCustomers('city')}>
          <Input size="lg" placeholder="Fresno"
            value={form.city} onChange={e => set('city', e.target.value)} />
        </Field>
        <Field label={tCustomers('state')}>
          <Input as="select" size="lg" value={form.state} onChange={e => set('state', e.target.value)}>
            <option value="">{tCommon('selectPlaceholder')}</option>
            {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </Input>
        </Field>
        <Field label={tCustomers('zip')}>
          <Input size="lg" placeholder="93706"
            value={form.zip} onChange={e => set('zip', e.target.value)} />
        </Field>
      </div>

      {error && <Callout tone="danger">{error}</Callout>}

      <div className="flex gap-3 mt-2">
        <Button variant="secondary" onClick={() => onNext(false)} disabled={loading} className="flex-1 py-2.5 text-sm">
          {t('skipForNow')}
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={loading || !form.name.trim()}
          loading={loading}
          className="flex-2 flex-grow py-2.5 text-sm"
        >
          {loading ? tCommon('loading') : t('continue')}
        </Button>
      </div>
    </div>
  )
}
