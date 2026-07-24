// app/(app)/vehicles/page.tsx
// Photo-driven fleet cards (mockup-22) — High gap: this shipped as a plain
// data table even though vehicles.photo_path/color/cab_type already existed
// and were never rendered. photo_path has never actually been populated
// anywhere yet (no upload UI existed) — see AddVehicleButton.tsx sibling
// (vehicle detail page) for where that gets fixed. Vehicles with no photo
// fall back to the existing custom vehicle-type SVG on a status-tinted
// gradient banner, NOT a fabricated stock photo (vehicle_types.generic_photo_path
// is a real column but has never been populated with actual asset paths —
// rendering a real signed photo when we have one, and a real icon otherwise,
// beats inventing a placeholder image that doesn't exist).
import { createClient } from '@/lib/supabase/server'
import { createStorageProvider } from '@/lib/storage'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import AddVehicleButton from './AddVehicleButton'
import { VEHICLE_TYPE_ICONS } from '@/components/icons/vehicle-types'
import ExceptionChip from '@/components/ExceptionChip'
import { getExceptions } from '@/lib/exceptions'
import { getProfileForUser } from '@/lib/queries/profiles'
import { vehicleStatusVariant, type VehicleStatus } from '@/lib/domain/vehicle-status'
import { Card, EmptyState, StatusBadge } from '@/components/ui'

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
  status: VehicleStatus | null
  photo_path: string | null
  cab_type: string | null
  color: string | null
  dimensions: string | null
  vehicle_types: { code: string } | { code: string }[] | null
}

type ActiveAssignment = {
  vehicle_id: number | null
  load_number: string
  status: string
  drivers: { driver_number: string } | { driver_number: string }[] | null
}

const BANNER_GRADIENTS: Record<string, string> = {
  active: 'from-[#1a3a8a] to-[#2563eb]',
  idle: 'from-[#374151] to-[#64748b]',
  in_shop: 'from-[#8a1a1a] to-[#dc2626]',
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
  let assignments: ActiveAssignment[] = []

  if (profile?.org_id) {
    const [{ data }, exceptionItems, { data: assignmentData }] = await Promise.all([
      supabase
        .from('vehicles')
        .select('id, vehicle_number, nickname, year, make, model, license_plate, license_state, is_active, status, photo_path, vehicle_type_id, cab_type, color, dimensions, vehicle_types(code, generic_photo_path)')
        .eq('carrier_org_id', profile.org_id)
        .eq('is_active', true)
        .order('vehicle_number'),
      getExceptions(supabase, profile.org_id),
      supabase
        .from('loads')
        .select('vehicle_id, load_number, status, drivers(driver_number)')
        .eq('carrier_org_id', profile.org_id)
        .in('status', ['dispatched', 'picked_up', 'in_transit'])
        .not('vehicle_id', 'is', null),
    ])
    vehicles = (data as unknown as Vehicle[]) ?? []
    exceptions = exceptionItems
    assignments = (assignmentData as unknown as ActiveAssignment[]) ?? []
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

  const assignmentByVehicle = new Map<number, ActiveAssignment>()
  for (const a of assignments) {
    if (a.vehicle_id != null && !assignmentByVehicle.has(a.vehicle_id)) {
      assignmentByVehicle.set(a.vehicle_id, a)
    }
  }

  const storage = createStorageProvider(supabase)
  const photoUrlByVehicle = new Map<number, string>()
  await Promise.all(
    vehicles
      .filter(v => v.photo_path)
      .map(async (v) => {
        try {
          const url = await storage.getSignedUrl(v.photo_path!, 3600)
          photoUrlByVehicle.set(v.id, url)
        } catch {
          // Missing/inaccessible object — card falls back to the icon banner.
        }
      })
  )

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
          <p className="text-text-sec text-sm mt-1">{t('truckCount', { count: vehicles.length })}</p>
        </div>
        {canManage && <AddVehicleButton />}
      </div>

      {justCreated && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-success/10 border border-success/20 px-4 py-3">
          <span className="material-symbols-outlined text-success text-[18px]">check_circle</span>
          <p className="text-success text-sm">{t('addedSuccess', { nickname: justCreated })}</p>
        </div>
      )}

      {vehicles.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center pb-8">
            <EmptyState icon="fire_truck" title={t('noTrucksYet')} />
            {canManage && <AddVehicleButton variant="empty" />}
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {vehicles.map((vehicle) => {
            const ymm = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
            const plate = [vehicle.license_plate, vehicle.license_state].filter(Boolean).join(' / ')
            const vt = Array.isArray(vehicle.vehicle_types) ? vehicle.vehicle_types[0] : vehicle.vehicle_types
            const Icon = vt ? VEHICLE_TYPE_ICONS[vt.code] : undefined
            const status = (vehicle.status ?? 'active') as VehicleStatus
            const topException = topExceptionByVehicle.get(vehicle.id)
            const assignment = assignmentByVehicle.get(vehicle.id)
            const driverRow = assignment
              ? (Array.isArray(assignment.drivers) ? assignment.drivers[0] : assignment.drivers)
              : null
            const photoUrl = photoUrlByVehicle.get(vehicle.id)

            return (
              <Card key={vehicle.id} className="overflow-hidden">
                <div className="flex flex-col sm:flex-row">
                  {/* Photo/icon banner */}
                  <div
                    className={`sm:w-52 h-36 sm:h-auto flex-shrink-0 flex items-center justify-center relative overflow-hidden ${
                      photoUrl ? '' : `bg-gradient-to-br ${BANNER_GRADIENTS[status]}`
                    }`}
                  >
                    {photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed URL, not a static/optimizable asset
                      <img src={photoUrl} alt={vehicle.nickname ?? vehicle.vehicle_number ?? ''} className="w-full h-full object-cover" />
                    ) : (
                      Icon && <Icon className="w-32 h-auto text-white/40" />
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
                      <p className="text-white text-[11px] font-bold tracking-wide">{vehicle.vehicle_number ?? '—'}</p>
                      {vt && <p className="text-white/75 text-[10px]">{t(`type_${vt.code}` as never)}</p>}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 p-4 flex flex-col gap-2 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {vehicle.vehicle_number ? (
                        <Link
                          href={`/vehicles/${vehicle.vehicle_number}`}
                          className="text-text-pri font-bold hover:text-brand-orange transition-colors rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                        >
                          {vehicle.nickname || vehicle.vehicle_number}
                        </Link>
                      ) : (
                        <span className="text-text-pri font-bold">{vehicle.nickname ?? '—'}</span>
                      )}
                      <StatusBadge variant={vehicleStatusVariant(status)} size="sm">
                        {t(`vstatus_${status}` as never)}
                      </StatusBadge>
                    </div>
                    <p className="text-text-sec text-xs">
                      {[ymm, vehicle.color, vehicle.cab_type ? t(`cabType${vehicle.cab_type === 'day_cab' ? 'DayCab' : vehicle.cab_type === 'sleeper' ? 'Sleeper' : 'Other'}` as never) : null, plate]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </p>
                    {topException && (
                      <div className="mt-1">
                        <ExceptionChip item={topException} />
                      </div>
                    )}
                  </div>

                  {/* Driver / assignment column */}
                  <div className="sm:w-56 flex-shrink-0 border-t sm:border-t-0 sm:border-l border-divider-ui p-4 flex flex-col justify-center gap-1">
                    {driverRow ? (
                      <>
                        <p className="text-text-pri text-sm font-medium">{driverRow.driver_number}</p>
                        <p className="text-text-sec text-xs">{assignment!.load_number}</p>
                      </>
                    ) : (
                      <p className="text-text-mut text-xs">{t('noDriverAssigned')}</p>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
