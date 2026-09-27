'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiClient } from '@/lib/api-client'
import { Button, Input } from '@/components/ui'

const CDL_CLASSES = ['A', 'B', 'C'] as const
const ENDORSEMENTS = ['hazmat', 'tanker', 'doubles', 'airbrakes', 'passenger'] as const

type Profile = {
  cdl_number: string | null
  cdl_class: (typeof CDL_CLASSES)[number] | null
  cdl_state: string | null
  endorsements: string[]
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  emergency_contact_relation: string | null
  default_vehicle_id: number | null
  cdl_expiry: string | null
  med_cert_expiry: string | null
}

type Vehicle = { id: number; vehicle_number: string | null; nickname: string }

export default function DriverProfileForm() {
  const t = useTranslations('drivers')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      apiClient.http.GET('/api/v1/me/driver-profile'),
      apiClient.http.GET('/api/v1/vehicles'),
    ]).then(([profileResult, vehiclesResult]) => {
      if (profileResult.data) setProfile(profileResult.data)
      setVehicles(vehiclesResult.data?.vehicles.map((v) => ({
        id: v.id,
        vehicle_number: v.vehicle_number,
        nickname: v.nickname,
      })) ?? [])
    }).catch(() => setError('Could not load your driver profile.'))
      .finally(() => setLoading(false))
  }, [])

  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((current) => current ? { ...current, [key]: value } : current)
    setSaved(false)
  }

  function toggleEndorsement(code: string) {
    if (!profile) return
    update('endorsements', profile.endorsements.includes(code)
      ? profile.endorsements.filter((value) => value !== code)
      : [...profile.endorsements, code])
  }

  async function save() {
    if (!profile) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const { response } = await apiClient.http.PATCH('/api/v1/me/driver-profile', {
        body: {
          cdl_number: profile.cdl_number || null,
          cdl_class: profile.cdl_class,
          cdl_state: profile.cdl_state || null,
          endorsements: profile.endorsements as Array<(typeof ENDORSEMENTS)[number]>,
          emergency_contact_name: profile.emergency_contact_name || null,
          emergency_contact_phone: profile.emergency_contact_phone || null,
          emergency_contact_relation: profile.emergency_contact_relation || null,
          default_vehicle_id: profile.default_vehicle_id,
        },
      })
      if (!response.ok) throw new Error('save failed')
      setSaved(true)
    } catch {
      setError('Could not save your driver profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-text-sec text-sm">Loading driver profile…</p>
  if (!profile) return <p className="text-text-sec text-sm">No driver profile is available for this account.</p>

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-text-pri font-medium">Driver profile</h2>
        <p className="text-text-sec text-sm mt-1">Keep your CDL and emergency-contact details current.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block text-xs font-medium text-text-sec">CDL number
          <Input size="lg" className="mt-1.5" value={profile.cdl_number ?? ''} onChange={(e) => update('cdl_number', e.target.value)} />
        </label>
        <label className="block text-xs font-medium text-text-sec">CDL state
          <Input size="lg" className="mt-1.5" maxLength={2} value={profile.cdl_state ?? ''} onChange={(e) => update('cdl_state', e.target.value.toUpperCase())} />
        </label>
      </div>

      <div>
        <p className="text-xs font-medium text-text-sec mb-2">{t('cdlClass')}</p>
        <div className="flex gap-2">
          {CDL_CLASSES.map((value) => (
            <button key={value} type="button" onClick={() => update('cdl_class', value)} className={`px-4 py-2 rounded-lg border text-sm ${profile.cdl_class === value ? 'border-brand-orange text-brand-orange bg-brand-orange/10' : 'border-border-ui text-text-sec'}`}>
              {value}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-text-sec mb-2">Endorsements</p>
        <div className="flex flex-wrap gap-2">
          {ENDORSEMENTS.map((code) => {
            const selected = profile.endorsements.includes(code)
            return <button key={code} type="button" onClick={() => toggleEndorsement(code)} className={`px-3 py-2 rounded-lg border text-sm ${selected ? 'border-brand-orange text-brand-orange bg-brand-orange/10' : 'border-border-ui text-text-sec'}`}>{t(`endorsement_${code}`)}</button>
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="block text-xs font-medium text-text-sec">Emergency contact
          <Input size="lg" className="mt-1.5" value={profile.emergency_contact_name ?? ''} onChange={(e) => update('emergency_contact_name', e.target.value)} />
        </label>
        <label className="block text-xs font-medium text-text-sec">Phone
          <Input size="lg" className="mt-1.5" value={profile.emergency_contact_phone ?? ''} onChange={(e) => update('emergency_contact_phone', e.target.value)} />
        </label>
        <label className="block text-xs font-medium text-text-sec">Relationship
          <Input size="lg" className="mt-1.5" value={profile.emergency_contact_relation ?? ''} onChange={(e) => update('emergency_contact_relation', e.target.value)} />
        </label>
      </div>

      <label className="block text-xs font-medium text-text-sec">Default vehicle
        <Input as="select" className="mt-1.5" value={profile.default_vehicle_id ?? ''} onChange={(e) => update('default_vehicle_id', e.target.value ? Number(e.target.value) : null)}>
          <option value="">No default vehicle</option>
          {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicle_number ?? vehicle.nickname} — {vehicle.nickname}</option>)}
        </Input>
      </label>

      <p className="text-text-mut text-xs">CDL expiry: {profile.cdl_expiry ?? 'Not on file'} · Medical certificate: {profile.med_cert_expiry ?? 'Not on file'} (managed by your carrier)</p>
      {error && <p className="text-danger text-sm">{error}</p>}
      {saved && <p className="text-success text-sm">Saved.</p>}
      <Button onClick={save} disabled={saving} loading={saving}>{saving ? 'Saving…' : 'Save driver profile'}</Button>
    </div>
  )
}
