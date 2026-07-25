'use client'
// app/onboarding/steps/AddVehicleStep.tsx
// Thin wrapper around POST /api/vehicles — zero backend changes. Optional:
// a brand-new solo operator may not have added a vehicle before their first
// load, so this step can be skipped and revisited from /vehicles later.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button, Callout, Field, Input } from '@/components/ui'

export default function AddVehicleStep({ onNext }: { onNext: (added: boolean) => void }) {
  const t = useTranslations('onboarding')
  const tVehicles = useTranslations('vehicles')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ nickname: '', year: '', make: '', model: '' })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: form.nickname.trim(),
          year: form.year ? Number(form.year) : undefined,
          make: form.make.trim() || undefined,
          model: form.model.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))
      onNext(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-white font-semibold text-lg mb-1">{t('stepVehicleTitle')}</h2>
      <p className="text-slate-400 text-sm mb-4">{t('stepVehicleSubtitle')}</p>

      <Field label={tVehicles('nickname')}>
        <Input size="lg" placeholder="Big Red"
          value={form.nickname} onChange={e => set('nickname', e.target.value)} />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label={tVehicles('year')}>
          <Input size="lg" placeholder="2022" inputMode="numeric"
            value={form.year} onChange={e => set('year', e.target.value)} />
        </Field>
        <Field label={tVehicles('make')}>
          <Input size="lg" placeholder="Freightliner"
            value={form.make} onChange={e => set('make', e.target.value)} />
        </Field>
        <Field label={tVehicles('model')}>
          <Input size="lg" placeholder="Cascadia"
            value={form.model} onChange={e => set('model', e.target.value)} />
        </Field>
      </div>

      {error && <Callout tone="danger">{error}</Callout>}

      <div className="flex gap-3 mt-2">
        <Button variant="secondary" onClick={() => onNext(false)} disabled={loading} className="flex-1 py-2.5 text-sm">
          {t('skipForNow')}
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={loading || !form.nickname.trim()}
          loading={loading}
          className="flex-2 flex-grow py-2.5 text-sm"
        >
          {loading ? tCommon('loading') : t('continue')}
        </Button>
      </div>
    </div>
  )
}
