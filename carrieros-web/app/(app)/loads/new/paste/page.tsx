// app/loads/new/paste/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button, Input } from '@/components/ui'

export default function PastePage() {
  const router = useRouter()
  const t = useTranslations('loadIntake.paste')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleExtract() {
    if (!text.trim()) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/extract-load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? t('extractionFailed'))
        return
      }

      const extracted = await res.json()
      // Store in sessionStorage and navigate to review
      sessionStorage.setItem('extracted_load', JSON.stringify({ ...extracted, raw_text: text }))
      router.push('/loads/new/review')
    } catch {
      setError(t('networkError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">

      <div className="mb-8">
        <Link href="/loads/new" className="text-text-sec text-sm hover:text-text-pri flex items-center gap-1.5 mb-4">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          {t('back')}
        </Link>
        <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
        <p className="text-text-sec text-sm mt-1">{t('subtitle')}</p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
          {error}
        </div>
      )}

      <Input
        as="textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste rate confirmation text here...

Example:
Load #: RC-29381
Shipper: ABC Freight LLC
Pickup: 123 Warehouse Blvd, Chicago, IL 60601 — 07/22/2026 08:00
Delivery: 456 Industrial Pkwy, Memphis, TN 38101 — 07/23/2026 14:00
Commodity: General Freight
Weight: 42,000 lbs
Rate: $2,850.00"
        rows={14}
        className="font-mono resize-none"
      />

      <div className="flex items-center justify-between mt-4">
        <p className="text-text-mut text-xs">
          {text.length > 0 ? t('charactersCount', { count: text.length }) : t('pasteHint')}
        </p>
        <Button onClick={handleExtract} disabled={!text.trim() || loading} loading={loading}>
          <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
          {loading ? t('extracting') : t('extract')}
        </Button>
      </div>

    </div>
  )
}
