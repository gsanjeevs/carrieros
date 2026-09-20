// components/ExtractionReview.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardBody, Input, Button } from '@/components/ui'

interface ExtractedLoad {
  customer_name_raw: string | null
  load_number_raw: string | null
  pickup_address: string | null
  pickup_city: string | null
  pickup_state: string | null
  pickup_zip: string | null
  pickup_date: string | null
  pickup_time: string | null
  delivery_address: string | null
  delivery_city: string | null
  delivery_state: string | null
  delivery_zip: string | null
  delivery_date: string | null
  delivery_time: string | null
  commodity: string | null
  weight_lbs: number | null
  rate: number | null
  total_miles: number | null
  raw_text: string
  confidence: {
    pickup: 'high' | 'medium' | 'low'
    delivery: 'high' | 'medium' | 'low'
    rate: 'high' | 'medium' | 'low'
    dates: 'high' | 'medium' | 'low'
  }
}

const CONFIDENCE_COLOR = {
  high:   'text-success',
  medium: 'text-warning',
  low:    'text-danger',
}

function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
  confidence,
  placeholder,
  confidenceLabels,
}: {
  label: string
  name: string
  value: string
  onChange: (name: string, val: string) => void
  type?: string
  confidence?: 'high' | 'medium' | 'low'
  placeholder?: string
  confidenceLabels: { high: string; medium: string; low: string }
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</label>
        {confidence && (
          <span className={`text-xs ${CONFIDENCE_COLOR[confidence]}`}>
            {confidenceLabels[confidence]}
          </span>
        )}
      </div>
      <Input
        size="lg"
        type={type}
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={placeholder ?? label}
      />
    </div>
  )
}

// Reads sessionStorage's one-time hand-off from the paste-extract page.
// Pulled out of the component so both lazy useState initializers below can
// call it without re-deriving the parsing logic — previously this ran the
// parse once in an effect and called setData/setFields directly in the
// effect body, which is exactly the "calling setState() directly within an
// effect" pattern react-hooks/set-state-in-effect flags (Modal.tsx and
// LanguageSwitcher.tsx have the same pre-existing, unfixed pattern
// elsewhere — this one's fixed here because raw-hex-audit work touched the
// file anyway). A lazy initializer runs once, synchronously, during the
// component's own render — not "setState in an effect" at all.
function readExtractedLoad(): ExtractedLoad | null {
  const raw = sessionStorage.getItem('extracted_load')
  return raw ? (JSON.parse(raw) as ExtractedLoad) : null
}

function fieldsFromExtractedLoad(parsed: ExtractedLoad | null): Record<string, string> {
  if (!parsed) return {}
  return {
    customer_name_raw:  parsed.customer_name_raw  ?? '',
    load_number_raw:    parsed.load_number_raw    ?? '',
    pickup_address:     parsed.pickup_address     ?? '',
    pickup_city:        parsed.pickup_city        ?? '',
    pickup_state:       parsed.pickup_state       ?? '',
    pickup_zip:         parsed.pickup_zip         ?? '',
    pickup_date:        parsed.pickup_date        ?? '',
    pickup_time:        parsed.pickup_time        ?? '',
    delivery_address:   parsed.delivery_address   ?? '',
    delivery_city:      parsed.delivery_city      ?? '',
    delivery_state:     parsed.delivery_state     ?? '',
    delivery_zip:       parsed.delivery_zip       ?? '',
    delivery_date:      parsed.delivery_date      ?? '',
    delivery_time:      parsed.delivery_time      ?? '',
    commodity:          parsed.commodity          ?? '',
    weight_lbs:         parsed.weight_lbs != null ? String(parsed.weight_lbs) : '',
    rate:               parsed.rate       != null ? String(parsed.rate)       : '',
    total_miles:        parsed.total_miles!= null ? String(parsed.total_miles): '',
  }
}

export default function ExtractionReview() {
  const router = useRouter()
  const t = useTranslations('loadIntake.review')
  const tSections = useTranslations('loadIntake.sections')
  const tFields = useTranslations('loadIntake.fields')
  const confidenceLabels = {
    high: t('confidenceConfident'),
    medium: t('confidenceReview'),
    low: t('confidenceCheck'),
  }
  const [data] = useState<ExtractedLoad | null>(() => readExtractedLoad())
  const [fields, setFields] = useState<Record<string, string>>(() => fieldsFromExtractedLoad(readExtractedLoad()))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Redirecting away is a legitimate effect (a real side effect reacting to
  // "there was nothing to review"), unlike the setData/setFields calls this
  // replaced above.
  useEffect(() => {
    if (!data) router.push('/loads/new')
  }, [data, router])

  function update(name: string, val: string) {
    setFields((prev) => ({ ...prev, [name]: val }))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/loads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...fields,
          weight_lbs:  fields.weight_lbs  ? Number(fields.weight_lbs)  : null,
          rate:        fields.rate        ? Number(fields.rate)         : null,
          total_miles: fields.total_miles ? Number(fields.total_miles)  : null,
          intake_method: 'paste',
          raw_intake_text: data?.raw_text ?? '',
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? t('failedToSave'))
        return
      }
      const { load_number } = await res.json()
      sessionStorage.removeItem('extracted_load')
      router.push(`/loads?created=${load_number}`)
    } catch {
      setError(t('networkError'))
    } finally {
      setSaving(false)
    }
  }

  if (!data) return null

  const c = data.confidence ?? {}

  return (
    <div className="p-8 max-w-3xl mx-auto">

      <div className="mb-8">
        <Link href="/loads/new/paste" className="text-slate-400 text-sm hover:text-white flex items-center gap-1.5 mb-4">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          {t('back')}
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
            <p className="text-slate-400 text-sm mt-1">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 bg-surface-card border border-border-ui rounded-lg px-3 py-1.5">
            <span className="material-symbols-outlined text-[14px] text-brand-orange">auto_awesome</span>
            {t('aiExtracted')}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-6">

        {/* Customer + reference */}
        <Card>
          <CardBody>
          <h2 className="text-text-pri text-sm font-medium mb-4">{tSections('customerReference')}</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label={tFields('customerBroker')} name="customer_name_raw" value={fields.customer_name_raw ?? ''} onChange={update} placeholder="Company name" confidenceLabels={confidenceLabels} />
            <Field label={tFields('loadReference')} name="load_number_raw" value={fields.load_number_raw ?? ''} onChange={update} placeholder="RC-12345" confidenceLabels={confidenceLabels} />
          </div>
          </CardBody>
        </Card>

        {/* Pickup */}
        <Card>
          <CardBody>
          <h2 className="text-text-pri text-sm font-medium mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-orange"></span>
            {tSections('pickup')}
          </h2>
          <div className="grid grid-cols-1 gap-4">
            <Field label={tFields('address')} name="pickup_address" value={fields.pickup_address ?? ''} onChange={update} confidence={c.pickup} confidenceLabels={confidenceLabels} />
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1">
                <Field label={tFields('city')} name="pickup_city" value={fields.pickup_city ?? ''} onChange={update} confidenceLabels={confidenceLabels} />
              </div>
              <Field label={tFields('state')} name="pickup_state" value={fields.pickup_state ?? ''} onChange={update} placeholder="IL" confidenceLabels={confidenceLabels} />
              <Field label={tFields('zip')} name="pickup_zip" value={fields.pickup_zip ?? ''} onChange={update} placeholder="60601" confidenceLabels={confidenceLabels} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label={tFields('date')} name="pickup_date" value={fields.pickup_date ?? ''} onChange={update} type="date" confidence={c.dates} confidenceLabels={confidenceLabels} />
              <Field label={tFields('time')} name="pickup_time" value={fields.pickup_time ?? ''} onChange={update} type="time" confidenceLabels={confidenceLabels} />
            </div>
          </div>
          </CardBody>
        </Card>

        {/* Delivery */}
        <Card>
          <CardBody>
          <h2 className="text-text-pri text-sm font-medium mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success"></span>
            {tSections('delivery')}
          </h2>
          <div className="grid grid-cols-1 gap-4">
            <Field label={tFields('address')} name="delivery_address" value={fields.delivery_address ?? ''} onChange={update} confidence={c.delivery} confidenceLabels={confidenceLabels} />
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1">
                <Field label={tFields('city')} name="delivery_city" value={fields.delivery_city ?? ''} onChange={update} confidenceLabels={confidenceLabels} />
              </div>
              <Field label={tFields('state')} name="delivery_state" value={fields.delivery_state ?? ''} onChange={update} placeholder="TN" confidenceLabels={confidenceLabels} />
              <Field label={tFields('zip')} name="delivery_zip" value={fields.delivery_zip ?? ''} onChange={update} placeholder="38101" confidenceLabels={confidenceLabels} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label={tFields('date')} name="delivery_date" value={fields.delivery_date ?? ''} onChange={update} type="date" confidence={c.dates} confidenceLabels={confidenceLabels} />
              <Field label={tFields('time')} name="delivery_time" value={fields.delivery_time ?? ''} onChange={update} type="time" confidenceLabels={confidenceLabels} />
            </div>
          </div>
          </CardBody>
        </Card>

        {/* Load details */}
        <Card>
          <CardBody>
          <h2 className="text-text-pri text-sm font-medium mb-4">{tSections('loadDetails')}</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label={tFields('commodity')} name="commodity" value={fields.commodity ?? ''} onChange={update} placeholder="General freight" confidenceLabels={confidenceLabels} />
            <Field label={tFields('weight')} name="weight_lbs" value={fields.weight_lbs ?? ''} onChange={update} type="number" placeholder="42000" confidenceLabels={confidenceLabels} />
            <Field label={tFields('rate')} name="rate" value={fields.rate ?? ''} onChange={update} type="number" confidence={c.rate} placeholder="2850" confidenceLabels={confidenceLabels} />
            <Field label={tFields('miles')} name="total_miles" value={fields.total_miles ?? ''} onChange={update} type="number" placeholder="530" confidenceLabels={confidenceLabels} />
          </div>
          </CardBody>
        </Card>

      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-8">
        <Link
          href="/loads/new/paste"
          className="text-slate-400 text-sm hover:text-white transition"
        >
          {t('reExtract')}
        </Link>
        <Button
          onClick={handleSave}
          disabled={saving}
          loading={saving}
        >
          {saving ? (
            <>{t('saving')}</>
          ) : (
            <>
              <span className="material-symbols-outlined text-[16px]">check</span>
              {t('confirmCreateLoad')}
            </>
          )}
        </Button>
      </div>

    </div>
  )
}
