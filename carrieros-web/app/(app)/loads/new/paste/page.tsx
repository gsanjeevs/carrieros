// app/loads/new/paste/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function PastePage() {
  const router = useRouter()
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
        setError(data.error ?? 'Extraction failed. Try again.')
        return
      }

      const extracted = await res.json()
      // Store in sessionStorage and navigate to review
      sessionStorage.setItem('extracted_load', JSON.stringify({ ...extracted, raw_text: text }))
      router.push('/loads/new/review')
    } catch {
      setError('Network error. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">

      <div className="mb-8">
        <Link href="/loads/new" className="text-slate-400 text-sm hover:text-white flex items-center gap-1.5 mb-4">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back
        </Link>
        <h1 className="text-2xl font-semibold text-white">Paste Rate Confirmation</h1>
        <p className="text-slate-400 text-sm mt-1">Paste the rate con text below — we'll extract pickup, delivery, rate, and commodity.</p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <textarea
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
        className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3.5 text-white placeholder-slate-600 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#f97316] focus:border-transparent transition resize-none"
      />

      <div className="flex items-center justify-between mt-4">
        <p className="text-slate-500 text-xs">
          {text.length > 0 ? `${text.length} characters` : 'Paste any text format — emails, PDFs, broker portals'}
        </p>
        <button
          onClick={handleExtract}
          disabled={!text.trim() || loading}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-[#f97316] focus:ring-offset-2 focus:ring-offset-[#0f1923]"
        >
          {loading ? (
            <>
              <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
              Extracting...
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
              Extract Load
            </>
          )}
        </button>
      </div>

    </div>
  )
}
