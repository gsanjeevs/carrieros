'use client'
// components/CompanyDocuments.tsx
// Company-level compliance documents (COI, MC authority, DOT certificate,
// UCR, W-9, business license, etc). Mirrors VehicleDocuments.tsx's
// upload/remove/signed-URL/orphan-cleanup pattern, wired to
// `org_documents` instead of `vehicle_documents` — there is no per-entity
// id, just the org. Storage paths MUST be
// `{carrier_org_id}/company/{filename}` or the storage policies 403 (same
// bucket, same org-id-first convention as loads/vehicles/dvir).
//
// RLS (owner_solo_org_docs_all / finance_org_docs_select) gives owner/solo
// full read-write and finance read-only; dispatchers and drivers have no
// access at all, so this component is only ever rendered for those three
// roles — see documents/page.tsx.

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { createStorageProvider } from '@/lib/storage'
import { Card, CardHeader, CardBody, Input, Button, StatusBadge } from '@/components/ui'

export type CompanyDocType =
  | 'coi'
  | 'general_liability'
  | 'workers_comp'
  | 'mc_authority'
  | 'dot_certificate'
  | 'ucr'
  | 'w9'
  | 'business_license'

export interface CompanyDocument {
  id: number
  type: CompanyDocType
  storagePath: string
  fileName: string
  isImage: boolean
  signedUrl: string | null
  expiryDate: string | null
  createdAtLabel: string
  uploaderName: string | null
}

const DOC_TYPES: CompanyDocType[] = [
  'coi', 'general_liability', 'workers_comp', 'mc_authority',
  'dot_certificate', 'ucr', 'w9', 'business_license',
]

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

export default function CompanyDocuments({
  documents,
  orgId,
  userId,
  canUpload,
  canDelete,
}: {
  documents: CompanyDocument[]
  orgId: number
  userId: string
  canUpload: boolean
  canDelete: boolean
}) {
  const t = useTranslations('companyDocuments')
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [docType, setDocType] = useState<CompanyDocType>('coi')
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
    const path = `${orgId}/company/${Date.now()}-${sanitize(file.name)}`

    try {
      await storage.uploadFile(path, file, file.type)
    } catch {
      setBusy(false)
      setError(t('docUploadFailed'))
      return
    }

    const { error: insErr } = await supabase.from('org_documents').insert({
      org_id: orgId,
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

  async function handleDelete(doc: CompanyDocument) {
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

    const { error: delErr } = await supabase.from('org_documents').delete().eq('id', doc.id)
    setDeletingId(null)
    if (delErr) {
      setError(t('docDeleteFailed'))
      return
    }
    router.refresh()
  }

  return (
    <Card className="shadow-card">
      <CardHeader className="flex-wrap gap-3">
        <div>
          <h2 className="text-text-pri font-medium text-sm">{t('title')}</h2>
          <p className="text-text-sec text-xs mt-0.5">{t('description')}</p>
        </div>
        {canUpload && (
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              as="select"
              value={docType}
              onChange={(e) => setDocType(e.target.value as CompanyDocType)}
              disabled={busy}
              aria-label={t('docType')}
            >
              {DOC_TYPES.map((ty) => (
                <option key={ty} value={ty}>{t(`cdocType_${ty}`)}</option>
              ))}
            </Input>
            <Input
              type="date"
              size="md"
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
            <Button
              size="lg"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="gap-1.5 px-3"
            >
              <span className="material-symbols-outlined text-[18px]">upload</span>
              {busy ? t('docUploading') : t('docUpload')}
            </Button>
          </div>
        )}
      </CardHeader>

      <CardBody>
      {error && <p className="text-danger text-xs mb-3">{error}</p>}

      {documents.length === 0 ? (
        <p className="text-text-mut text-sm">{t('noDocumentsYet')}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {documents.map((doc) => {
            const status = expiryStatus(doc.expiryDate)
            return (
              <div
                key={doc.id}
                className="group relative bg-surface-card border border-border-ui rounded-lg overflow-hidden shadow-card hover:bg-surface-subtle hover:border-brand-orange/20 hover:shadow-hover transition-all duration-150"
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
                      className="w-full h-28 object-cover bg-image-scrim"
                    />
                  ) : (
                    <div className="w-full h-28 flex flex-col items-center justify-center gap-1 bg-surface-subtle">
                      <span className="material-symbols-outlined text-text-mut text-[28px]">
                        description
                      </span>
                      <span className="text-text-sec text-[11px] px-2 truncate max-w-full">
                        {doc.fileName}
                      </span>
                    </div>
                  )}
                </a>

                {status && (
                  <StatusBadge
                    variant={status === 'expired' ? 'danger' : 'warning'}
                    size="sm"
                    className="absolute top-1.5 left-1.5"
                  >
                    {status === 'expired' ? t('docExpired') : t('docExpiringSoon')}
                  </StatusBadge>
                )}

                <div className="p-2.5">
                  <p className="text-text-pri text-xs font-medium">{t(`cdocType_${doc.type}`)}</p>
                  {doc.expiryDate && (
                    <p className="text-text-sec text-[11px] mt-0.5">{t('docExpiresLabel', { date: doc.expiryDate })}</p>
                  )}
                  <p className="text-text-sec text-[11px] mt-0.5">{doc.createdAtLabel}</p>
                  <p className="text-text-sec text-[11px]">
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
                    className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-danger text-danger-on-primary hover:bg-danger-dark flex items-center justify-center transition disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
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
