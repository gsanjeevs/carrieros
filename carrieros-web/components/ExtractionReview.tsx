// components/ExtractionReview.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

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
  high:   'text-[#16a34a]',
  medium: 'text-[#d97706]',
  low:    'text-[#dc2626]',
}

function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
  confidence,
  placeholder,
}: {
  label: string
  name: string
  value: string
  onChange: (name: string, val: string) => void
  type?: string
  confidence?: 'high' | 'medium' | 'low'
  placeholder?: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</label>
        {confidence && (
          <span className={`text-xs ${CONFIDENCE_COLOR[confidence]}`}>
            {confidence === 'high' ? '✓ confident' : confidence === 'medium' ? '~ review' : '⚠ check'}
          </span>
        )}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={placeholder ?? label}
        className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-[#f97316] focus:border-transparent transition"
      />
    </div>
  )
}

export default function ExtractionReview() {
  const router = useRouter()
  const [data, setData] = useState<ExtractedLoad | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const raw = sessionStorage.getItem('extracted_load')
    if (!raw) {
      router.push('/loads/new')
      return
    }
    const parsed: ExtractedLoad = JSON.parse(raw)
    setData(parsed)
    setFields({
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
    })
  }, [router])

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
        setError(d.error ?? 'Failed to save load.')
        return
      }
      const { load_number } = await res.json()
      sessionStorage.removeItem('extracted_load')
      router.push(`/loads?created=${load_number}`)
    } catch {
      setError('Network error. Try again.')
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
          Back
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Review Extracted Load</h1>
            <p className="text-slate-400 text-sm mt-1">Check the details below — edit anything that looks off.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 bg-white/5 border border-white/8 rounded-lg px-3 py-1.5">
            <span className="material-symbols-outlined text-[14px] text-[#f97316]">auto_awesome</span>
            AI extracted
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
        <div className="bg-white/5 border border-white/8 rounded-xl p-5">
          <h2 className="text-white text-sm font-medium mb-4">Customer & Reference</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Customer / Broker" name="customer_name_raw" value={fields.customer_name_raw ?? ''} onChange={update} placeholder="Company name" />
            <Field label="Load / Reference #" name="load_number_raw" value={fields.load_number_raw ?? ''} onChange={update} placeholder="RC-12345" />
          </div>
        </div>

        {/* Pickup */}
        <div className="bg-white/5 border border-white/8 rounded-xl p-5">
          <h2 className="text-white text-sm font-medium mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#f97316]"></span>
            Pickup
          </h2>
          <div className="grid grid-cols-1 gap-4">
            <Field label="Address" name="pickup_address" value={fields.pickup_address ?? ''} onChange={update} confidence={c.pickup} />
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1">
                <Field label="City" name="pickup_city" value={fields.pickup_city ?? ''} onChange={update} />
              </div>
              <Field label="State" name="pickup_state" value={fields.pickup_state ?? ''} onChange={update} placeholder="IL" />
              <Field label="ZIP" name="pickup_zip" value={fields.pickup_zip ?? ''} onChange={update} placeholder="60601" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Date" name="pickup_date" value={fields.pickup_date ?? ''} onChange={update} type="date" confidence={c.dates} />
              <Field label="Time" name="pickup_time" value={fields.pickup_time ?? ''} onChange={update} type="time" />
            </div>
          </div>
        </div>

        {/* Delivery */}
        <div className="bg-white/5 border border-white/8 rounded-xl p-5">
          <h2 className="text-white text-sm font-medium mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#16a34a]"></span>
            Delivery
          </h2>
          <div className="grid grid-cols-1 gap-4">
            <Field label="Address" name="delivery_address" value={fields.delivery_address ?? ''} onChange={update} confidence={c.delivery} />
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1">
                <Field label="City" name="delivery_city" value={fields.delivery_city ?? ''} onChange={update} />
              </div>
              <Field label="State" name="delivery_state" value={fields.delivery_state ?? ''} onChange={update} placeholder="TN" />
              <Field label="ZIP" name="delivery_zip" value={fields.delivery_zip ?? ''} onChange={update} placeholder="38101" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Date" name="delivery_date" value={fields.delivery_date ?? ''} onChange={update} type="date" confidence={c.dates} />
              <Field label="Time" name="delivery_time" value={fields.delivery_time ?? ''} onChange={update} type="time" />
            </div>
          </div>
        </div>

        {/* Load details */}
        <div className="bg-white/5 border border-white/8 rounded-xl p-5">
          <h2 className="text-white text-sm font-medium mb-4">Load Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Commodity" name="commodity" value={fields.commodity ?? ''} onChange={update} placeholder="General freight" />
            <Field label="Weight (lbs)" name="weight_lbs" value={fields.weight_lbs ?? ''} onChange={update} type="number" placeholder="42000" />
            <Field label="Rate ($)" name="rate" value={fields.rate ?? ''} onChange={update} type="number" confidence={c.rate} placeholder="2850" />
            <Field label="Miles" name="total_miles" value={fields.total_miles ?? ''} onChange={update} type="number" placeholder="530" />
          </div>
        </div>

      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-8">
        <Link
          href="/loads/new/paste"
          className="text-slate-400 text-sm hover:text-white transition"
        >
          Re-extract
        </Link>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition"
        >
          {saving ? (
            <>
              <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
              Saving...
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[16px]">check</span>
              Confirm & Create Load
            </>
          )}
        </button>
      </div>

    </div>
  )
}
