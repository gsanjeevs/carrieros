'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { apiClient } from '@/lib/api-client'
import { Button, Card, CardBody } from '@/components/ui'

const MAX_BYTES = 5 * 1024 * 1024
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic'
type AvatarContentType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'

// ADR 0003: this form never touches Supabase storage/tables directly -- both
// actions go through the signed-upload/finalize API contract, same as every
// other client-component data write in this app. router.refresh() re-runs the
// settings Server Component to
// get a fresh signed URL rather than this component trying to sign one itself.
export default function ProfilePhotoForm({ currentUrl }: { currentUrl: string | null }) {
  const t = useTranslations('settings')
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(currentUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function upload(file: File) {
    setError('')
    if (file.size > MAX_BYTES) { setError(t('photoSizeError')); return }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(file.type)) { setError(t('photoTypeError')); return }
    setBusy(true)
    const slot = await apiClient.http.POST('/api/v1/me/avatar/uploads', {
      body: { content_type: file.type as AvatarContentType, size_bytes: file.size },
    })
    if (!slot.data) { setBusy(false); setError(t('photoUploadError')); return }
    const put = await fetch(slot.data.upload_url, { method: 'PUT', headers: { 'Content-Type': slot.data.content_type }, body: file })
    if (!put.ok) { setBusy(false); setError(t('photoUploadError')); return }
    const { response } = await apiClient.http.POST('/api/v1/me/avatar', { body: { storage_path: slot.data.storage_path } })
    setBusy(false)
    if (!response.ok) { setError(t('photoUploadError')); return }
    router.refresh()
  }

  async function remove() {
    setBusy(true)
    const { response } = await apiClient.http.DELETE('/api/v1/me/avatar')
    setBusy(false)
    if (!response.ok) { setError(t('photoRemoveError')); return }
    setUrl(null)
    router.refresh()
  }

  return (
    <Card className="mb-6"><CardBody>
      <div className="flex items-center gap-4">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, per-user Supabase storage
          // URL with a rotating token; next/image would need next.config.ts remotePatterns for a
          // dynamic org-specific host, not worth the config surface for a profile thumbnail.
          <img src={url} alt={t('photoAlt')} className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-surface-subtle flex items-center justify-center text-text-sec text-xl">?</div>
        )}
        <div className="flex-1"><p className="text-text-pri text-sm font-medium">{t('photoTitle')}</p><p className="text-text-sec text-xs mt-1">{t('photoSubtitle')}</p></div>
        <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file) }} />
        <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? t('photoSaving') : t('photoChoose')}</Button>
        {url && <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()}>{t('photoRemove')}</Button>}
      </div>
      {error && <p className="text-danger text-xs mt-3">{error}</p>}
    </CardBody></Card>
  )
}
