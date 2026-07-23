'use client'
// app/(app)/settings/ProfileSettingsForm.tsx
// Plain CRUD on the caller's own profiles row — direct Supabase call from
// the browser client, no API route needed (decision R3b; RLS already grants
// own_profile_update). Mirrors the pattern LanguageSwitcher.tsx established.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Button, Input } from '@/components/ui'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ' },
  { code: 'ur', label: 'اردو' },
]

const DATE_FORMAT_EXAMPLES: Record<string, string> = {
  'MM/DD/YYYY': '07/20/2026',
  'DD/MM/YYYY': '20/07/2026',
  'YYYY-MM-DD': '2026-07-20',
}

type Uom = 'imperial' | 'metric'

interface Current {
  preferred_language: string
  uom_system: Uom | null
  date_format: string
  time_format: string
}

const labelCls = 'block text-xs font-medium text-text-sec mb-1.5'

export default function ProfileSettingsForm({
  userId,
  current,
  orgDefaultUom,
}: {
  userId: string
  current: Current
  orgDefaultUom: Uom
}) {
  const router = useRouter()
  const t = useTranslations('settings')
  const [form, setForm] = useState(current)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)

    const supabase = createClient()
    const { error: err } = await supabase
      .from('profiles')
      .update({
        preferred_language: form.preferred_language,
        uom_system: form.uom_system,
        date_format: form.date_format,
        time_format: form.time_format,
      })
      .eq('id', userId)

    setSaving(false)
    if (err) {
      setError(t('saveError'))
      return
    }

    document.cookie = `locale=${form.preferred_language};path=/;max-age=${60 * 60 * 24 * 365}`
    setSaved(true)
    router.refresh()

    if (form.preferred_language !== current.preferred_language) {
      window.location.reload()
    }
  }

  return (
    <div className="space-y-6">

      <div>
        <label className={labelCls}>{t('language')}</label>
        <Input
          as="select"
          value={form.preferred_language}
          onChange={(e) => setForm(f => ({ ...f, preferred_language: e.target.value }))}
        >
          {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </Input>
      </div>

      <div>
        <label className={labelCls}>{t('units')}</label>
        <Input
          as="select"
          value={form.uom_system ?? ''}
          onChange={(e) => setForm(f => ({ ...f, uom_system: (e.target.value || null) as Uom | null }))}
        >
          <option value="">
            {t('unitsCompanyDefault', { unit: t(orgDefaultUom === 'imperial' ? 'unitsImperialShort' : 'unitsMetricShort') })}
          </option>
          <option value="imperial">{t('unitsImperial')}</option>
          <option value="metric">{t('unitsMetric')}</option>
        </Input>
      </div>

      <div>
        <label className={labelCls}>{t('dateFormat')}</label>
        <Input
          as="select"
          value={form.date_format}
          onChange={(e) => setForm(f => ({ ...f, date_format: e.target.value }))}
        >
          {Object.entries(DATE_FORMAT_EXAMPLES).map(([code, example]) => (
            <option key={code} value={code}>{code} (e.g. {example})</option>
          ))}
        </Input>
      </div>

      <div>
        <label className={labelCls}>{t('timeFormat')}</label>
        <Input
          as="select"
          value={form.time_format}
          onChange={(e) => setForm(f => ({ ...f, time_format: e.target.value }))}
        >
          <option value="12h">{t('time12h')}</option>
          <option value="24h">{t('time24h')}</option>
        </Input>
      </div>

      {error && (
        <div className="rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
          {error}
        </div>
      )}

      <Button onClick={save} disabled={saving} loading={saving}>
        {saving ? t('saving') : saved ? t('saved') : t('saveChanges')}
      </Button>

    </div>
  )
}
