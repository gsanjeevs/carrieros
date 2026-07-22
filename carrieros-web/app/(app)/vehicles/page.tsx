// app/(app)/vehicles/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import AddVehicleButton from './AddVehicleButton'

type Vehicle = {
  id: number
  vehicle_number: string | null
  nickname: string | null
  year: number | null
  make: string | null
  model: string | null
  license_plate: string | null
  license_state: string | null
  is_active: boolean | null
}

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  const params = await searchParams
  const justCreated = params.created
  const canManage = ['owner', 'solo'].includes(profile?.role ?? '')

  const t = await getTranslations('vehicles')

  let vehicles: Vehicle[] = []

  if (profile?.org_id) {
    const { data } = await supabase
      .from('vehicles')
      .select('id, vehicle_number, nickname, year, make, model, license_plate, license_state, is_active')
      .eq('carrier_org_id', profile.org_id)
      .eq('is_active', true)
      .order('vehicle_number')
    vehicles = data ?? []
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('truckCount', { count: vehicles.length })}</p>
        </div>
        {canManage && <AddVehicleButton />}
      </div>

      {justCreated && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-[#16a34a]/10 border border-[#16a34a]/20 px-4 py-3">
          <span className="material-symbols-outlined text-[#16a34a] text-[18px]">check_circle</span>
          <p className="text-[#16a34a] text-sm">{t('addedSuccess', { nickname: justCreated })}</p>
        </div>
      )}

      {vehicles.length === 0 ? (
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
          <span className="material-symbols-outlined text-slate-600 text-4xl">fire_truck</span>
          <p className="text-slate-500 text-sm mt-3">{t('noTrucksYet')}</p>
          {canManage && <AddVehicleButton variant="empty" />}
        </div>
      ) : (
        <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('truckNumber')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('nickname')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('yearMakeModel')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('plate')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {vehicles.map((vehicle) => {
                const ymm = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
                const plate = [vehicle.license_plate, vehicle.license_state].filter(Boolean).join(' / ')

                return (
                  <tr key={vehicle.id} className="hover:bg-white/[0.07] transition-colors duration-150">
                    <td className="px-5 py-3.5 text-white font-medium">{vehicle.vehicle_number}</td>
                    <td className="px-4 py-3.5 text-slate-300">{vehicle.nickname ?? '—'}</td>
                    <td className="px-4 py-3.5 text-slate-400">{ymm || '—'}</td>
                    <td className="px-4 py-3.5 text-slate-400">{plate || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
