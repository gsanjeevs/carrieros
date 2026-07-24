'use client'
// app/(app)/vehicles/[vehicle_number]/VehiclePhotoUpload.tsx
// Closes the loop the fleet-inventory redesign (mockup-22) depends on:
// vehicles.photo_path has existed since decisions.md S10 but no upload UI
// ever wrote to it. Mirrors components/VehicleDocuments.tsx's upload
// pattern exactly (same bucket, same {carrier_org_id}/vehicles/{id}/... path
// convention) but updates the vehicle row directly instead of inserting a
// vehicle_documents row — this is the vehicle's own photo, not a compliance
// document.
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { createStorageProvider } from '@/lib/storage'

const ACCEPT = 'image/jpeg,image/png,image/heic,image/webp'
const MAX_BYTES = 10 * 1024 * 1024

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

export default function VehiclePhotoUpload({
  vehicleId,
  orgId,
  photoUrl,
  canUpload,
}: {
  vehicleId: number
  orgId: number
  photoUrl: string | null
  canUpload: boolean
}) {
  const t = useTranslations('vehicles')
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleFile(file: File) {
    setError('')
    if (file.size > MAX_BYTES) {
      setError(t('docTooLarge'))
      return
    }
    setBusy(true)
    const supabase = createClient()
    const storage = createStorageProvider(supabase)
    const path = `${orgId}/vehicles/${vehicleId}/photo-${Date.now()}-${sanitize(file.name)}`

    try {
      await storage.uploadFile(path, file, file.type)
    } catch {
      setBusy(false)
      setError(t('photoUploadFailed'))
      return
    }

    const { error: updateErr } = await supabase.from('vehicles').update({ photo_path: path }).eq('id', vehicleId)
    if (updateErr) {
      await storage.remove([path]).catch(() => {})
      setBusy(false)
      setError(t('photoUploadFailed'))
      return
    }

    setBusy(false)
    router.refresh()
  }

  if (!canUpload) {
    // eslint-disable-next-line @next/next/no-img-element -- signed URL, not a static asset
    return photoUrl ? <img src={photoUrl} alt="" className="w-16 h-16 rounded-lg object-cover" /> : null
  }

  return (
    <div className="flex items-center gap-3">
      {photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL, not a static asset
        <img src={photoUrl} alt="" className="w-16 h-16 rounded-lg object-cover" />
      )}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="text-xs font-semibold text-brand-orange hover:underline disabled:opacity-40"
      >
        {busy ? t('docUploading') : photoUrl ? t('replacePhoto') : t('uploadPhoto')}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
      {error && <span className="text-danger text-xs">{error}</span>}
    </div>
  )
}
