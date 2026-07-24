'use client'
// components/DriverDocuments.tsx
// Driver documents (CDL scans, medical certs): upload/remove/signed-URL/
// orphan-cleanup pattern mirrors LoadDocuments.tsx / VehicleDocuments.tsx
// exactly, wired to `driver_documents`. Storage paths MUST be
// `{carrier_org_id}/drivers/{driver_id}/{filename}` or the storage policies
// 403 (same bucket, same org-id-first convention as loads/vehicles/dvir).
//
// Rendered as a TIMELINE (most recent first) rather than a flat grid — this
// tab's whole point is showing the history of CDL/med-cert scans over time,
// not just the current document.

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { createStorageProvider } from '@/lib/storage'

export type DriverDocType = 'cdl_scan' | 'medical_cert' | 'other'

export interface DriverDocument {
  id: number
  type: DriverDocType
  storagePath: string
  fileName: string
  isImage: boolean
  signedUrl: string | null
  expiryDate: string | null
  createdAtLabel: string
  uploaderName: string | null
}

const DOC_TYPES: DriverDocType[] = ['cdl_scan', 'medical_cert', 'other']

const ACCEPT = 'image/jpeg,image/png,image/heic,image/webp,application/pdf'
const MAX_BYTES = 10 * 1024 * 1024
const EXPIRY_WARNING_DAYS = 30

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

type ExpiryStatus = 'expired' | 'expiringSoon' | null

function expiryStatus(expiryDate: string | null): ExpiryStatus {
  if (!expiryDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(expiryDate)
  const daysUntil = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  if (daysUntil < 0) return 'expired'
  if (daysUntil <= EXPIRY_WARNING_DAYS) return 'expiringSoon'
  return null
}

export default function DriverDocuments({
  documents,
  driverId,
  orgId,
  userId,
  canUpload,
  canDelete,
}: {
  documents: DriverDocument[]
  driverId: number
  orgId: number
  userId: string
  canUpload: boolean
  canDelete: boolean
}) {
  const t = useTranslations('drivers')
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [docType, setDocType] = useState<DriverDocType>('cdl_scan')
  const [expiryDate, setExpiryDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)

  async function handleFile(file: File) {
    setError('')
    if (file.size > MAX_BYTES) {
      setError(t('docTooLarge'))
      return
    }

    setBusy(true)
    const supabase = createClient()
    const storage = createStorageProvider(supabase)
    const path = `${orgId}/drivers/${driverId}/${Date.now()}-${sanitize(file.name)}`

    try {
      await storage.uploadFile(path, file, file.type)
    } catch {
      setBusy(false)
      setError(t('docUploadFailed'))
      return
    }

    const { error: insErr } = await supabase.from('driver_documents').insert({
      driver_id: driverId,
      carrier_org_id: orgId,
      doc_type: docType,
      storage_path: path,
      expiry_date: expiryDate || null,
      uploaded_by: userId,
    })

    if (insErr) {
      // Clean up the orphaned object so storage doesn't drift from the table.
      await storage.remove([path]).catch(() => {})
      setBusy(false)
      setError(t('docUploadFailed'))
      return
    }

    setBusy(false)
    setExpiryDate('')
    if (fileRef.current) fileRef.current.value = ''
    router.refresh()
  }

  async function handleDelete(doc: DriverDocument) {
    if (!window.confirm(t('docDeleteConfirm', { name: doc.fileName }))) return

    setError('')
    setDeletingId(doc.id)
    const supabase = createClient()

    try {
      await createStorageProvider(supabase).remove([doc.storagePath])
    } catch {
      setDeletingId(null)
      setError(t('docDeleteFailed'))
      return
    }

    const { error: delErr } = await supabase.from('driver_documents').delete().eq('id', doc.id)
    setDeletingId(null)
    if (delErr) {
      setError(t('docDeleteFailed'))
      return
    }
    router.refresh()
  }

  const selectCls =
    'bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/40 transition'

  return (
    <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-white font-medium text-sm">{t('driverDocuments')}</h2>
        {canUpload && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className={selectCls}
              value={docType}
              onChange={(e) => setDocType(e.target.value as DriverDocType)}
              disabled={busy}
              aria-label={t('docType')}
            >
              {DOC_TYPES.map((ty) => (
                <option key={ty} value={ty}>{t(`ddocType_${ty}`)}</option>
              ))}
            </select>
            <input
              type="date"
              className={selectCls}
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              disabled={busy}
              aria-label={t('docExpiryDate')}
            />
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
            >
              <span className="material-symbols-outlined text-[18px]">upload</span>
              {busy ? t('docUploading') : t('docUpload')}
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

      {documents.length === 0 ? (
        <p className="text-slate-500 text-sm">{t('noDocumentsYet')}</p>
      ) : (
        <div className="relative pl-6">
          <div className="absolute left-[9px] top-1.5 bottom-1.5 w-px bg-white/10" />
          <div className="space-y-4">
            {documents.map((doc) => {
              const status = expiryStatus(doc.expiryDate)
              return (
                <div key={doc.id} className="relative">
                  <span className="absolute -left-6 top-1.5 w-[9px] h-[9px] rounded-full bg-brand-orange ring-4 ring-navy" />
                  <div className="group relative flex items-start gap-3 bg-white/5 border border-white/8 rounded-lg p-3 shadow-card-dark hover:bg-white/[0.07] hover:border-white/15 hover:shadow-hover-dark transition-all duration-150">
                    <a
                      href={doc.signedUrl ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                    >
                      {doc.isImage && doc.signedUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={doc.signedUrl}
                          alt={doc.fileName}
                          className="w-16 h-16 rounded-md object-cover bg-black/30"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-md flex items-center justify-center bg-black/20">
                          <span className="material-symbols-outlined text-slate-500 text-[24px]">description</span>
                        </div>
                      )}
                    </a>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white text-xs font-medium">{t(`ddocType_${doc.type}`)}</p>
                        {status && (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              status === 'expired' ? 'bg-red-500/80 text-white' : 'bg-amber-500/80 text-white'
                            }`}
                          >
                            {status === 'expired' ? t('docExpired') : t('docExpiringSoon')}
                          </span>
                        )}
                      </div>
                      {doc.expiryDate && (
                        <p className="text-slate-500 text-[11px] mt-0.5">{t('docExpiresLabel', { date: doc.expiryDate })}</p>
                      )}
                      <p className="text-slate-500 text-[11px] mt-0.5 truncate">{doc.fileName}</p>
                      <p className="text-slate-600 text-[11px] mt-0.5">
                        {doc.createdAtLabel} · {doc.uploaderName ?? t('docUnknownUploader')}
                      </p>
                    </div>

                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(doc)}
                        disabled={deletingId === doc.id}
                        title={t('docDelete')}
                        aria-label={t('docDelete')}
                        className="shrink-0 w-7 h-7 rounded-md bg-black/40 hover:bg-red-500/80 text-white flex items-center justify-center transition disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
