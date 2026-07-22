// app/(app)/vehicles/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import AddVehicleButton from './AddVehicleButton'
import { VEHICLE_TYPE_ICONS } from '@/components/icons/vehicle-types'
import ExceptionChip from '@/components/ExceptionChip'
import { getExceptions } from '@/lib/exceptions'
import { getProfileForUser } from '@/lib/queries/profiles'

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
  cab_type: string | null
  color: string | null
  dimensions: string | null
  vehicle_types: { code: string } | { code: string }[] | null
}

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  const params = await searchParams
  const justCreated = params.created
  const canManage = ['owner', 'solo'].includes(profile?.role ?? '')

  const t = await getTranslations('vehicles')

  let vehicles: Vehicle[] = []
  let exceptions: Awaited<ReturnType<typeof getExceptions>> = []

  if (profile?.org_id) {
    const [{ data }, exceptionItems] = await Promise.all([
      supabase
        .from('vehicles')
        .select('id, vehicle_number, nickname, year, make, model, license_plate, license_state, is_active, vehicle_type_id, cab_type, color, dimensions, vehicle_types(code, generic_photo_path)')
        .eq('carrier_org_id', profile.org_id)
        .eq('is_active', true)
        .order('vehicle_number'),
      getExceptions(supabase, profile.org_id),
    ])
    vehicles = (data as unknown as Vehicle[]) ?? []
    exceptions = exceptionItems
  }

  // get_exceptions() is already sorted most-urgent-first (today, then
  // this_week, then upcoming, by due_at within a tier) — the first match per
  // vehicle is its top exception.
  const topExceptionByVehicle = new Map<number, (typeof exceptions)[number]>()
  for (const item of exceptions) {
    if (item.entity_type === 'vehicle' && !topExceptionByVehicle.has(item.entity_id)) {
      topExceptionByVehicle.set(item.entity_id, item)
    }
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
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center shadow-card-dark">
          <span className="material-symbols-outlined text-slate-600 text-4xl">fire_truck</span>
          <p className="text-slate-500 text-sm mt-3">{t('noTrucksYet')}</p>
          {canManage && <AddVehicleButton variant="empty" />}
        </div>
      ) : (
        <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('truckNumber')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('type')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('nickname')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('yearMakeModel')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('plate')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('details')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {vehicles.map((vehicle) => {
                const ymm = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
                const plate = [vehicle.license_plate, vehicle.license_state].filter(Boolean).join(' / ')
                const vt = Array.isArray(vehicle.vehicle_types) ? vehicle.vehicle_types[0] : vehicle.vehicle_types
                const Icon = vt ? VEHICLE_TYPE_ICONS[vt.code] : undefined
                const details = [vehicle.color, vehicle.dimensions].filter(Boolean).join(' · ')
                const topException = topExceptionByVehicle.get(vehicle.id)

                return (
                  <tr key={vehicle.id} className="hover:bg-white/[0.07] transition-colors duration-150">
                    <td className="px-5 py-3.5 text-white font-medium">
                      {vehicle.vehicle_number ? (
                        <Link
                          href={`/vehicles/${vehicle.vehicle_number}`}
                          className="hover:text-[#f97316] transition-colors rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                        >
                          {vehicle.vehicle_number}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">
                      {vt ? (
                        <span className="inline-flex items-center gap-2">
                          {Icon && <Icon className="w-5 h-5 text-slate-400" />}
                          <span className="text-slate-300 text-sm">{t(`type_${vt.code}` as never)}</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">{vehicle.nickname ?? '—'}</td>
                    <td className="px-4 py-3.5 text-slate-400">{ymm || '—'}</td>
                    <td className="px-4 py-3.5 text-slate-400">{plate || '—'}</td>
                    <td className="px-4 py-3.5 text-slate-500 text-xs">{details || '—'}</td>
                    <td className="px-4 py-3.5">{topException && <ExceptionChip item={topException} />}</td>
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
