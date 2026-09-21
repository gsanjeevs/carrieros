'use client'
// app/(app)/settings/branding/BrandingForm.tsx
// Client form for POST /api/settings/branding — uploads a logo file and/or
// sets the two brand-color overrides in one multipart request. Mirrors
// app/onboarding/steps/AddLogoStep.tsx's upload affordance (same accept
// list, same 5MB limit) but posts through the API route instead of writing
// to Supabase directly, since carrier_details (the color half) is
// server-write-only (migration 0019) and this keeps the logo + color writes
// in one request instead of splitting client-direct-write and API-route
// calls across two code paths.
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Callout, Input } from '@/components/ui'
import { isValidBrandColor } from '@/lib/domain/branding'

const ACCEPT = 'image/jpeg,image/png,image/webp'
const MAX_BYTES = 5 * 1024 * 1024

interface Props {
  current: {
    logoUrl: string | null
    primaryColor: string | null
    accentColor: string | null
  }
}

export default function BrandingForm({ current }: Props) {
  const router = useRouter()
  const t = useTranslations('brandingSettings')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  const fileRef = useRef<HTMLInputElement>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(current.logoUrl)
  const [primaryColor, setPrimaryColor] = useState(current.primaryColor ?? '')
  const [accentColor, setAccentColor] = useState(current.accentColor ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  function handleFile(file: File) {
    setError('')
    setSaved(false)
    if (file.size > MAX_BYTES) {
      setError(t('logoTooLarge'))
      return
    }
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  function handleColorChange(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setter(e.target.value)
      setSaved(false)
    }
  }

  async function submit() {
    setError('')
    setSaved(false)

    if (primaryColor && !isValidBrandColor(primaryColor)) {
      setError(t('invalidColor'))
      return
    }
    if (accentColor && !isValidBrandColor(accentColor)) {
      setError(t('invalidColor'))
      return
    }

    setSaving(true)
    try {
      const form = new FormData()
      if (logoFile) form.set('logo', logoFile)
      form.set('primary_color', primaryColor)
      form.set('accent_color', accentColor)

      const res = await fetch('/api/settings/branding', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))

      setLogoFile(null)
      setSaved(true)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-xs font-medium text-text-sec mb-1.5">{t('logoLabel')}</label>
        <div className="flex items-center gap-4">
          {logoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL / object URL, not a static asset
            <img src={logoPreview} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-surface-subtle" />
          ) : (
            <span className="material-symbols-outlined text-text-mut text-4xl shrink-0">business</span>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-sm font-semibold text-brand-orange hover:underline focus:outline-none focus:ring-2 focus:ring-brand-orange/50 rounded"
          >
            {logoPreview ? t('replaceLogo') : t('uploadLogo')}
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
      </div>

      <div>
        <label className="block text-xs font-medium text-text-sec mb-1.5">{t('primaryColorLabel')}</label>
        <div className="flex items-center gap-2">
          <span
            className="w-8 h-8 rounded-md border border-border-ui shrink-0"
            style={{ backgroundColor: isValidBrandColor(primaryColor) ? primaryColor : 'transparent' }}
          />
          <Input
            value={primaryColor}
            onChange={handleColorChange(setPrimaryColor)}
            placeholder="#f47920"
            className="font-mono"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-sec mb-1.5">{t('accentColorLabel')}</label>
        <div className="flex items-center gap-2">
          <span
            className="w-8 h-8 rounded-md border border-border-ui shrink-0"
            style={{ backgroundColor: isValidBrandColor(accentColor) ? accentColor : 'transparent' }}
          />
          <Input
            value={accentColor}
            onChange={handleColorChange(setAccentColor)}
            placeholder="#1abc9c"
            className="font-mono"
          />
        </div>
      </div>
      <p className="text-xs text-text-mut">{t('colorHelp')}</p>

      {error && <Callout tone="danger">{error}</Callout>}
      {saved && <Callout tone="success">{t('saved')}</Callout>}

      <Button onClick={submit} disabled={saving} loading={saving}>
        {saving ? tCommon('loading') : t('save')}
      </Button>
    </div>
  )
}
