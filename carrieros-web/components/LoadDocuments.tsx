'use client'
// components/LoadDocuments.tsx
// Load documents (POD photos, BOLs, rate cons): list + upload + delete.
// Plain RLS-protected CRUD, so it talks to Supabase directly from the browser
// client — no API route (decision R3b). Storage paths MUST be
// `{carrier_org_id}/loads/{load_id}/{filename}` or the storage policies 403.

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { createStorageProvider } from '@/lib/storage'
import { Card, CardHeader, CardBody } from '@/components/ui'

export type DocType = 'pod' | 'rate_con' | 'bol' | 'other'

export interface LoadDocument {
  id: number
  type: DocType
  storagePath: string
  fileName: string
  isImage: boolean
  signedUrl: string | null
  createdAtLabel: string
  uploaderName: string | null
}

const DOC_TYPES: DocType[] = ['pod', 'rate_con', 'bol', 'other']

const ACCEPT = 'image/jpeg,image/png,image/heic,image/webp,application/pdf'
const MAX_BYTES = 10 * 1024 * 1024

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

export default function LoadDocuments({
  documents,
  loadId,
  orgId,
  userId,
  canUpload,
  canDelete,
}: {
  documents: LoadDocument[]
  loadId: number
  orgId: number
  userId: string
  canUpload: boolean
  canDelete: boolean
}) {
  const t = useTranslations('loads')
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [docType, setDocType] = useState<DocType>('pod')
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
    const path = `${orgId}/loads/${loadId}/${Date.now()}-${sanitize(file.name)}`

    try {
      await storage.uploadFile(path, file, file.type)
    } catch {
      setBusy(false)
      setError(t('docUploadFailed'))
      return
    }

    const { error: insErr } = await supabase.from('documents').insert({
      load_id: loadId,
      carrier_org_id: orgId,
      type: docType,
      storage_path: path,
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
    if (fileRef.current) fileRef.current.value = ''
    router.refresh()
  }

  async function handleDelete(doc: LoadDocument) {
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

    const { error: delErr } = await supabase.from('documents').delete().eq('id', doc.id)
    setDeletingId(null)
    if (delErr) {
      setError(t('docDeleteFailed'))
      return
    }
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-text-pri font-medium text-sm">{t('documents')}</h2>
        {canUpload && (
          <div className="flex items-center gap-2">
            {/* Input's "select" mode can't take a size prop here — SelectHTMLAttributes'
                own numeric `size` (visible rows) collides with InputSize in the union type
                (pre-existing components/ui/Input.tsx typing gap), so this uses a plain
                <select> styled to match the original local selectCls instead. */}
            <select
              className="bg-surface-input border border-border-ui rounded-lg px-3 py-2 text-text-pri text-sm cursor-pointer outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/40 transition"
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocType)}
              disabled={busy}
              aria-label={t('docType')}
            >
              {DOC_TYPES.map((ty) => (
                <option key={ty} value={ty}>{t(`docType_${ty}`)}</option>
              ))}
            </select>
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
        <p className="text-text-mut text-sm">{t('noDocumentsYet')}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="group relative bg-surface-card border border-border-ui rounded-lg overflow-hidden hover:bg-surface-subtle hover:border-brand-orange/30 hover:shadow-hover-dark transition-all duration-150"
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

              <div className="p-2.5">
                <p className="text-white text-xs font-medium">{t(`docType_${doc.type}`)}</p>
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
          ))}
        </div>
      )}
      </CardBody>
    </Card>
  )
}
