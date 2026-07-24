'use client'
// components/BulkImportCustomers.tsx
// PRD: "Bulk customer import via CSV or XLS... Preview table shown before
// import... Rows missing Company Name are skipped with a count shown...
// Duplicate company names flagged; user chooses skip or overwrite per
// row... Max 50 customers per import for MVP... Template CSV downloadable
// from the import screen." XLS is explicitly out of scope for this pass —
// CSV covers the same accountant/spreadsheet workflow with zero parsing
// library, consistent with this project's hand-rolled-CSV precedent
// (app/api/loads/export/route.ts).
//
// Two-step flow: pick a file -> parsed preview table (per-row status +
// skip/overwrite choice for duplicates) -> confirm posts the resolved rows
// to POST /api/customers/bulk-import.

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

const MAX_ROWS = 50

interface ExistingCustomer {
  name: string | null
}

interface ParsedRow {
  name: string
  contact_name: string
  phone: string
  email: string
}

type RowStatus = 'valid' | 'missing_name' | 'duplicate'

interface PreviewRow extends ParsedRow {
  status: RowStatus
  action: 'create' | 'skip' | 'overwrite'
}

interface ImportResult {
  name: string
  action: string
  customerNumber: string | null
  orgId: number | null
}

// Minimal RFC-4180 field parser — handles quoted fields containing commas
// and escaped quotes ("") since a customer name/address may contain either.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some((f) => f.trim() !== '')) rows.push(row)
  }
  return rows
}

function downloadTemplate() {
  const csv = 'Company Name,Contact Name,Email,Phone\nFast Freight LLC,Mike Paulson,dispatch@fastfreight.example,(555) 123-4567\n'
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'customer-import-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function BulkImportCustomers({ existingCustomers }: { existingCustomers: ExistingCustomer[] }) {
  const t = useTranslations('customers')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [missingNameCount, setMissingNameCount] = useState(0)
  const [truncatedCount, setTruncatedCount] = useState(0)
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<ImportResult[] | null>(null)

  const existingNames = new Set(
    existingCustomers.map((c) => (c.name ?? '').trim().toLowerCase()).filter(Boolean)
  )

  function reset() {
    setRows([])
    setMissingNameCount(0)
    setTruncatedCount(0)
    setParseError('')
    setResults(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function close() {
    if (importing) return
    setOpen(false)
    reset()
  }

  async function handleFile(file: File) {
    setParseError('')
    setResults(null)
    const text = await file.text()
    const table = parseCsv(text)
    if (table.length === 0) {
      setParseError(t('importEmptyFile'))
      return
    }

    const header = table[0].map((h) => h.trim().toLowerCase())
    const idx = {
      name: header.indexOf('company name'),
      contact: header.indexOf('contact name'),
      email: header.indexOf('email'),
      phone: header.indexOf('phone'),
    }
    if (idx.name === -1) {
      setParseError(t('importMissingHeader'))
      return
    }

    const dataRows = table.slice(1)
    let missing = 0
    const parsed: ParsedRow[] = []
    for (const r of dataRows) {
      const name = (r[idx.name] ?? '').trim()
      if (!name) { missing++; continue }
      parsed.push({
        name,
        contact_name: idx.contact >= 0 ? (r[idx.contact] ?? '').trim() : '',
        email: idx.email >= 0 ? (r[idx.email] ?? '').trim() : '',
        phone: idx.phone >= 0 ? (r[idx.phone] ?? '').trim() : '',
      })
    }

    const truncated = Math.max(0, parsed.length - MAX_ROWS)
    const capped = parsed.slice(0, MAX_ROWS)

    setMissingNameCount(missing)
    setTruncatedCount(truncated)
    setRows(
      capped.map((r) => {
        const isDup = existingNames.has(r.name.toLowerCase())
        return {
          ...r,
          status: isDup ? 'duplicate' : 'valid',
          action: isDup ? 'skip' : 'create',
        }
      })
    )
  }

  function setRowAction(i: number, action: PreviewRow['action']) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, action } : r)))
  }

  async function confirmImport() {
    setImporting(true)
    setParseError('')
    try {
      const res = await fetch('/api/customers/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: rows.map((r) => ({
            name: r.name,
            contact_name: r.contact_name || undefined,
            email: r.email || undefined,
            phone: r.phone || undefined,
            action: r.action,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error_code ?? 'SERVER_ERROR')
      setResults(json.results)
      router.refresh()
    } catch {
      setParseError(t('importFailed'))
    } finally {
      setImporting(false)
    }
  }

  const createdCount = results?.filter((r) => r.action === 'created').length ?? 0
  const updatedCount = results?.filter((r) => r.action === 'overwritten').length ?? 0
  const skippedCount = results?.filter((r) => r.action.startsWith('skipped')).length ?? 0

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/8 text-white text-sm font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
      >
        <span className="material-symbols-outlined text-[18px]">upload_file</span>
        {t('bulkImport')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-2xl bg-navy border border-white/10 rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">{t('bulkImport')}</h2>
              <button onClick={close} className="text-slate-500 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50 rounded">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {results ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-success/10 border border-success/20 px-4 py-3 text-success text-sm">
                  {t('importSummary', { created: createdCount, updated: updatedCount, skipped: skippedCount })}
                </div>
                <button
                  onClick={close}
                  className="w-full py-2.5 bg-brand-orange hover:bg-brand-orange-hover text-white font-semibold rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                >
                  {tCommon('done')}
                </button>
              </div>
            ) : rows.length === 0 ? (
              <div className="space-y-4">
                <p className="text-slate-400 text-sm">{t('importInstructions', { max: MAX_ROWS })}</p>
                <button
                  onClick={downloadTemplate}
                  className="flex items-center gap-1.5 text-brand-orange hover:text-[#fb923c] text-sm font-medium transition"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  {t('downloadTemplate')}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                  }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full py-8 border-2 border-dashed border-white/15 hover:border-brand-orange/50 rounded-xl text-slate-400 hover:text-white text-sm transition flex flex-col items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[28px]">upload_file</span>
                  {t('chooseCsvFile')}
                </button>
                {parseError && <p className="text-red-400 text-xs">{parseError}</p>}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-slate-400 text-xs space-y-1">
                  <p>{t('importRowCount', { count: rows.length })}</p>
                  {missingNameCount > 0 && <p className="text-amber-400">{t('importMissingNameCount', { count: missingNameCount })}</p>}
                  {truncatedCount > 0 && <p className="text-amber-400">{t('importTruncatedCount', { count: truncatedCount, max: MAX_ROWS })}</p>}
                </div>

                <div className="border border-white/10 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-white/5 text-slate-400 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">{t('companyName')}</th>
                        <th className="text-left px-3 py-2">{t('contactName')}</th>
                        <th className="text-left px-3 py-2">{t('email')}</th>
                        <th className="text-left px-3 py-2">{t('importStatus')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t border-white/5">
                          <td className="px-3 py-2 text-white">{r.name}</td>
                          <td className="px-3 py-2 text-slate-300">{r.contact_name || '—'}</td>
                          <td className="px-3 py-2 text-slate-300">{r.email || '—'}</td>
                          <td className="px-3 py-2">
                            {r.status === 'duplicate' ? (
                              <select
                                className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white"
                                value={r.action}
                                onChange={(e) => setRowAction(i, e.target.value as PreviewRow['action'])}
                              >
                                <option value="skip">{t('importSkip')}</option>
                                <option value="overwrite">{t('importOverwrite')}</option>
                              </select>
                            ) : (
                              <span className="text-emerald-400 text-xs">{t('importNew')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {parseError && <p className="text-red-400 text-xs">{parseError}</p>}

                <div className="flex gap-3">
                  <button
                    onClick={reset}
                    disabled={importing}
                    className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white font-medium rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                  >
                    {tCommon('cancel')}
                  </button>
                  <button
                    onClick={confirmImport}
                    disabled={importing}
                    className="flex-2 flex-grow py-2.5 bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-40 text-white font-semibold rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                  >
                    {importing ? t('importing') : t('importConfirm', { count: rows.length })}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
