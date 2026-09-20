// components/ManualLoadForm.tsx
// Manual load entry (docs/feature-completeness-audit.md's #1-ranked gap,
// 2026-07-22) — the "Enter manually" tile on /loads/new was disabled with a
// "Coming soon" label even though POST /api/loads already accepted a full
// load body and already defaulted intake_method to 'manual'. This wires a
// form to that already-correct route; no backend change was needed.
//
// Deliberately a separate component from ExtractionReview.tsx rather than a
// shared abstraction, even though the field layout is ~90% identical —
// ExtractionReview also handles AI confidence badges and a sessionStorage
// prefill this flow has no use for. Per Rule B's incremental-adoption
// philosophy: two near-identical consumers isn't yet the threshold for
// forcing a shared form component; the natural time to extract one is when
// the (currently unbuilt) PDF-upload flow becomes a third consumer.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardBody, Field, Input } from '@/components/ui'

function FormField({
  label,
  name,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  name: string
  value: string
  onChange: (name: string, val: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <Field label={label} htmlFor={name}>
      <Input
        id={name}
        size="lg"
        type={type}
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={placeholder ?? label}
      />
    </Field>
  )
}

const EMPTY_FIELDS = {
  customer_name_raw: '',
  load_number_raw: '',
  pickup_address: '',
  pickup_city: '',
  pickup_state: '',
  pickup_zip: '',
  pickup_date: '',
  pickup_time: '',
  delivery_address: '',
  delivery_city: '',
  delivery_state: '',
  delivery_zip: '',
  delivery_date: '',
  delivery_time: '',
  commodity: '',
  weight_lbs: '',
  rate: '',
  total_miles: '',
}

export default function ManualLoadForm() {
  const router = useRouter()
  const t = useTranslations('loadIntake.manual')
  const tSections = useTranslations('loadIntake.sections')
  const tFields = useTranslations('loadIntake.fields')
  const [fields, setFields] = useState<Record<string, string>>(EMPTY_FIELDS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function update(name: string, val: string) {
    setFields((prev) => ({ ...prev, [name]: val }))
  }

  async function handleSave() {
    setError('')
    if (!fields.pickup_city && !fields.delivery_city && !fields.customer_name_raw) {
      setError(t('errorMinimum'))
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/loads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...fields,
          weight_lbs: fields.weight_lbs ? Number(fields.weight_lbs) : null,
          rate: fields.rate ? Number(fields.rate) : null,
          total_miles: fields.total_miles ? Number(fields.total_miles) : null,
          intake_method: 'manual',
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? t('failedToSave'))
        return
      }
      const { load_number } = await res.json()
      router.push(`/loads?created=${load_number}`)
    } catch {
      setError(t('networkError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">

      <div className="mb-8">
        <Link href="/loads/new" className="text-slate-400 text-sm hover:text-white flex items-center gap-1.5 mb-4 rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          {t('back')}
        </Link>
        <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
        <p className="text-slate-400 text-sm mt-1">{t('subtitle')}</p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-6">

        <Card>
          <CardBody>
          <h2 className="text-white text-sm font-medium mb-4">{tSections('customerReference')}</h2>
          <div className="grid grid-cols-2 gap-4">
            <FormField label={tFields('customerBroker')} name="customer_name_raw" value={fields.customer_name_raw} onChange={update} placeholder="Company name" />
            <FormField label={tFields('loadReference')} name="load_number_raw" value={fields.load_number_raw} onChange={update} placeholder="RC-12345" />
          </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
          <h2 className="text-white text-sm font-medium mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-orange"></span>
            {tSections('pickup')}
          </h2>
          <div className="grid grid-cols-1 gap-4">
            <FormField label={tFields('address')} name="pickup_address" value={fields.pickup_address} onChange={update} />
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1">
                <FormField label={tFields('city')} name="pickup_city" value={fields.pickup_city} onChange={update} />
              </div>
              <FormField label={tFields('state')} name="pickup_state" value={fields.pickup_state} onChange={update} placeholder="IL" />
              <FormField label={tFields('zip')} name="pickup_zip" value={fields.pickup_zip} onChange={update} placeholder="60601" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label={tFields('date')} name="pickup_date" value={fields.pickup_date} onChange={update} type="date" />
              <FormField label={tFields('time')} name="pickup_time" value={fields.pickup_time} onChange={update} type="time" />
            </div>
          </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
          <h2 className="text-white text-sm font-medium mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success"></span>
            {tSections('delivery')}
          </h2>
          <div className="grid grid-cols-1 gap-4">
            <FormField label={tFields('address')} name="delivery_address" value={fields.delivery_address} onChange={update} />
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1">
                <FormField label={tFields('city')} name="delivery_city" value={fields.delivery_city} onChange={update} />
              </div>
              <FormField label={tFields('state')} name="delivery_state" value={fields.delivery_state} onChange={update} placeholder="TN" />
              <FormField label={tFields('zip')} name="delivery_zip" value={fields.delivery_zip} onChange={update} placeholder="38101" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label={tFields('date')} name="delivery_date" value={fields.delivery_date} onChange={update} type="date" />
              <FormField label={tFields('time')} name="delivery_time" value={fields.delivery_time} onChange={update} type="time" />
            </div>
          </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
          <h2 className="text-white text-sm font-medium mb-4">{tSections('loadDetails')}</h2>
          <div className="grid grid-cols-2 gap-4">
            <FormField label={tFields('commodity')} name="commodity" value={fields.commodity} onChange={update} placeholder="General freight" />
            <FormField label={tFields('weight')} name="weight_lbs" value={fields.weight_lbs} onChange={update} type="number" placeholder="42000" />
            <FormField label={tFields('rate')} name="rate" value={fields.rate} onChange={update} type="number" placeholder="2850" />
            <FormField label={tFields('miles')} name="total_miles" value={fields.total_miles} onChange={update} type="number" placeholder="530" />
          </div>
          </CardBody>
        </Card>

      </div>

      <div className="flex items-center justify-end mt-8">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          {saving ? (
            <>
              <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
              {t('saving')}
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[16px]">check</span>
              {t('createLoad')}
            </>
          )}
        </button>
      </div>

    </div>
  )
}
