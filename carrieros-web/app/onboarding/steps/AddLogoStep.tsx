'use client'
// app/onboarding/steps/AddLogoStep.tsx
// Onboarding-gap audit: organizations.logo_path has existed since
// decisions.md S10 but no UI ever wrote to it anywhere in the app — this is
// that upload UI, placed right after the 'profile' step since it's the
// first point in the flow where orgId exists. Mirrors
// app/(app)/vehicles/[vehicle_number]/VehiclePhotoUpload.tsx's upload
// pattern (same bucket, same {org_id}/logo/{filename} path convention,
// direct browser-client write relying on owner_solo_org_update RLS) but
// updates organizations directly instead of a vehicle row. Optional/
// skippable — a missing logo never blocked anything before this step
// existed, so it shouldn't start blocking now.
import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { createStorageProvider } from '@/lib/storage'

const ACCEPT = 'image/jpeg,image/png,image/webp'
const MAX_BYTES = 5 * 1024 * 1024

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

export default function AddLogoStep({ orgId, onNext }: { orgId: number; onNext: () => void }) {
  const t = useTranslations('onboarding')
  const tVehicles = useTranslations('vehicles')
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError('')
    if (file.size > MAX_BYTES) {
      setError(tVehicles('docTooLarge'))
      return
    }
    setBusy(true)
    const supabase = createClient()
    const storage = createStorageProvider(supabase)
    const path = `${orgId}/logo/logo-${Date.now()}-${sanitize(file.name)}`

    try {
      await storage.uploadFile(path, file, file.type)
    } catch {
      setBusy(false)
      setError(t('logoUploadFailed'))
      return
    }

    const { error: updateErr } = await supabase.from('organizations').update({ logo_path: path }).eq('id', orgId)
    if (updateErr) {
      await storage.remove([path]).catch(() => {})
      setBusy(false)
      setError(t('logoUploadFailed'))
      return
    }

    const signedUrl = await storage.getSignedUrl(path, 60 * 10).catch(() => null)
    setLogoUrl(signedUrl)
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      <h2 className="text-white font-semibold text-lg mb-1">{t('stepLogoTitle')}</h2>
      <p className="text-slate-400 text-sm mb-4">{t('stepLogoSubtitle')}</p>

      <div className="rounded-lg bg-white/5 border border-white/10 px-4 py-4 flex items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL, not a static asset
          <img src={logoUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
        ) : (
          <span className="material-symbols-outlined text-slate-400 text-4xl shrink-0">business</span>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="text-sm font-semibold text-brand-orange hover:underline disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-orange/50 rounded"
        >
          {busy ? tVehicles('docUploading') : logoUrl ? t('replaceLogo') : t('uploadLogo')}
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
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3 mt-2">
        {!logoUrl && (
          <button
            onClick={onNext}
            disabled={busy}
            className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white font-medium rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
          >
            {t('skipForNow')}
          </button>
        )}
        <button
          onClick={onNext}
          className={`py-2.5 bg-brand-orange hover:bg-brand-orange-hover text-white font-semibold rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50 ${logoUrl ? 'w-full' : 'flex-2 flex-grow'}`}
        >
          {t('continue')}
        </button>
      </div>
    </div>
  )
}
