'use client'
// components/VehicleDocuments.tsx
// Vehicle documents (registration, insurance, DOT authority, annual
// inspection): list + upload + delete. Mirrors LoadDocuments.tsx's
// upload/remove/signed-URL/orphan-cleanup pattern exactly, wired to
// `vehicle_documents` instead of `documents`. Storage paths MUST be
// `{carrier_org_id}/vehicles/{vehicle_id}/{filename}` or the storage
// policies 403 (same bucket, same org-id-first convention as loads/dvir).

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { createStorageProvider } from '@/lib/storage'
import { Card, CardHeader, CardBody } from '@/components/ui'

export type VehicleDocType = 'registration' | 'insurance_cert' | 'dot_authority' | 'annual_inspection' | 'other'

export interface VehicleDocument {
  id: number
  type: VehicleDocType
  storagePath: string
  fileName: string
  isImage: boolean
  signedUrl: string | null
  expiryDate: string | null
  createdAtLabel: string
  uploaderName: string | null
}

const DOC_TYPES: VehicleDocType[] = ['registration', 'insurance_cert', 'dot_authority', 'annual_inspection', 'other']

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

export default function VehicleDocuments({
  documents,
  vehicleId,
  orgId,
  userId,
  canUpload,
  canDelete,
}: {
  documents: VehicleDocument[]
  vehicleId: number
  orgId: number
  userId: string
  canUpload: boolean
  canDelete: boolean
}) {
  const t = useTranslations('vehicles')
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [docType, setDocType] = useState<VehicleDocType>('registration')
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
    const path = `${orgId}/vehicles/${vehicleId}/${Date.now()}-${sanitize(file.name)}`

    try {
      await storage.uploadFile(path, file, file.type)
    } catch {
      setBusy(false)
      setError(t('docUploadFailed'))
      return
    }

    const { error: insErr } = await supabase.from('vehicle_documents').insert({
      vehicle_id: vehicleId,
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

  async function handleDelete(doc: VehicleDocument) {
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

    const { error: delErr } = await supabase.from('vehicle_documents').delete().eq('id', doc.id)
    setDeletingId(null)
    if (delErr) {
      setError(t('docDeleteFailed'))
      return
    }
    router.refresh()
  }

  const selectCls =
    'bg-surface-input border border-border-ui rounded-lg px-3 py-2 text-text-pri text-sm focus:outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/40 transition'

  return (
    <Card>
      <CardHeader className="flex-wrap gap-3">
        <h2 className="text-text-pri font-medium text-sm">{t('vehicleDocuments')}</h2>
        {canUpload && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className={selectCls}
              value={docType}
              onChange={(e) => setDocType(e.target.value as VehicleDocType)}
              disabled={busy}
              aria-label={t('docType')}
            >
              {DOC_TYPES.map((ty) => (
                <option key={ty} value={ty}>{t(`vdocType_${ty}`)}</option>
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
      </CardHeader>

      <CardBody>

      {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

      {documents.length === 0 ? (
        <p className="text-slate-500 text-sm">{t('noDocumentsYet')}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {documents.map((doc) => {
            const status = expiryStatus(doc.expiryDate)
            return (
              <div
                key={doc.id}
                className="group relative bg-surface-card border border-border-ui rounded-lg overflow-hidden shadow-card hover:bg-surface-subtle hover:border-brand-orange/30 hover:shadow-hover transition-all duration-150"
              >
                <a
                  href={doc.signedUrl ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="block focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                >
                  {doc.isImage && doc.signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={doc.signedUrl}
                      alt={doc.fileName}
                      className="w-full h-28 object-cover bg-black/30"
                    />
                  ) : (
                    <div className="w-full h-28 flex flex-col items-center justify-center gap-1 bg-black/20">
                      <span className="material-symbols-outlined text-slate-500 text-[28px]">
                        description
                      </span>
                      <span className="text-slate-400 text-[11px] px-2 truncate max-w-full">
                        {doc.fileName}
                      </span>
                    </div>
                  )}
                </a>

                {status && (
                  <span
                    className={`absolute top-1.5 left-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      status === 'expired' ? 'bg-red-500/80 text-white' : 'bg-amber-500/80 text-white'
                    }`}
                  >
                    {status === 'expired' ? t('docExpired') : t('docExpiringSoon')}
                  </span>
                )}

                <div className="p-2.5">
                  <p className="text-white text-xs font-medium">{t(`vdocType_${doc.type}`)}</p>
                  {doc.expiryDate && (
                    <p className="text-slate-500 text-[11px] mt-0.5">{t('docExpiresLabel', { date: doc.expiryDate })}</p>
                  )}
                  <p className="text-slate-500 text-[11px] mt-0.5">{doc.createdAtLabel}</p>
                  <p className="text-slate-500 text-[11px]">
                    {doc.uploaderName ?? t('docUnknownUploader')}
                  </p>
                </div>

                {canDelete && (
                  <button
                    type="button"
                    onClick={() => handleDelete(doc)}
                    disabled={deletingId === doc.id}
                    title={t('docDelete')}
                    aria-label={t('docDelete')}
                    className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-black/60 hover:bg-red-500/80 text-white flex items-center justify-center transition disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      </CardBody>
    </Card>
  )
}
