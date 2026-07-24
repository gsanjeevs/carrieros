// app/(app)/vehicles/[vehicle_number]/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import VehicleTabs from './VehicleTabs'
import FuelStopsSection, { type FuelStopRow } from '@/components/FuelStopsSection'
import VehicleDocuments, { type VehicleDocType, type VehicleDocument } from '@/components/VehicleDocuments'
import VehiclePhotoUpload from './VehiclePhotoUpload'
import { VEHICLE_TYPE_ICONS } from '@/components/icons/vehicle-types'
import { MAINTENANCE_ICONS } from '@/components/icons/maintenance'
import { formatDate, formatDateTime, toDate } from '@/lib/format-datetime'
import { formatMoney } from '@/lib/format-money'
import { loadStatusVariant, type LoadStatus } from '@/lib/domain/load-status'
import { vehicleStatusVariant, type VehicleStatus } from '@/lib/domain/vehicle-status'
import { Card, CardHeader, CardBody, KpiTile, StatusBadge, type StatusBadgeVariant, Table, TableHeaderCell, TableRow, TableCell, ProgressBar, EmptyState } from '@/components/ui'
import { createStorageProvider } from '@/lib/storage'

type MaintStatus = 'overdue' | 'dueSoon' | 'ok' | 'noDate'

function computeMaintStatus(nextDueDate: string | null): MaintStatus {
  if (!nextDueDate) return 'noDate'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = toDate(nextDueDate)
  const daysUntil = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  if (daysUntil < 0) return 'overdue'
  if (daysUntil <= 14) return 'dueSoon'
  return 'ok'
}

// Not a DB column (computed client-side from vehicles.next_due_date), and
// only rendered on this page — no cross-file drift risk, so this stays
// local rather than becoming a lib/domain/ module (unlike LoadStatus/
// VehicleStatus/InviteStatus, which are duplicated elsewhere).
const MAINT_STATUS_VARIANT: Record<MaintStatus, StatusBadgeVariant> = {
  overdue: 'danger',
  dueSoon: 'warning',
  ok:      'success',
  noDate:  'neutral',
}

function subtractMonths(dateStr: string, months: number): string {
  const d = toDate(dateStr)
  d.setMonth(d.getMonth() - months)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type MaintProgress = { pct: number; status: Exclude<MaintStatus, 'noDate'> } | null

function computeMaintProgress(r: {
  next_due_date: string | null
  last_service_date: string | null
  trigger_months: number | null
}): MaintProgress {
  if (!r.next_due_date) return null
  // computeMaintStatus can only return 'noDate' when next_due_date is null,
  // already excluded above — safe to narrow.
  const status = computeMaintStatus(r.next_due_date) as Exclude<MaintStatus, 'noDate'>
  const baseline = r.last_service_date
    ?? (r.trigger_months ? subtractMonths(r.next_due_date, r.trigger_months) : null)
  if (!baseline) return null
  const start = toDate(baseline).getTime()
  const end = toDate(r.next_due_date).getTime()
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  if (end <= start) return { pct: 1, status }
  const pct = (now.getTime() - start) / (end - start)
  return { pct: Math.min(1, Math.max(0, pct)), status }
}

const PROGRESS_BAR_VARIANT: Record<Exclude<MaintStatus, 'noDate'>, 'success' | 'warning' | 'danger'> = {
  overdue: 'danger',
  dueSoon: 'warning',
  ok:      'success',
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-divider-ui last:border-0">
      <span className="text-text-sec text-sm">{label}</span>
      <span className="text-text-pri text-sm text-right ml-4">{value ?? '—'}</span>
    </div>
  )
}

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ vehicle_number: string }>
}) {
  const { vehicle_number } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role, date_format, time_format')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) redirect('/onboarding')

  const t = await getTranslations('vehicles')
  const tLoads = await getTranslations('loads')
  const locale = await getLocale()

  // Fetch vehicle
  const { data: vehicleRow } = await supabase
    .from('vehicles')
    .select('*, vehicle_types(code)')
    .eq('vehicle_number', vehicle_number)
    .eq('carrier_org_id', profile.org_id)
    .single()

  if (!vehicleRow) notFound()

  const vehicle = vehicleRow as typeof vehicleRow & {
    vehicle_types: { code: string } | { code: string }[] | null
  }
  const vt = Array.isArray(vehicle.vehicle_types) ? vehicle.vehicle_types[0] : vehicle.vehicle_types
  const TypeIcon = vt ? VEHICLE_TYPE_ICONS[vt.code] : undefined

  const canManage = ['owner', 'solo'].includes(profile.role)

  const storage = createStorageProvider(supabase)

  let photoUrl: string | null = null
  if (vehicle.photo_path) {
    photoUrl = await storage.getSignedUrl(vehicle.photo_path, 60 * 60).catch(() => null)
  }
  const showRate = ['owner', 'solo', 'finance'].includes(profile.role)

  // ─── Documents ───
  const { data: docRows } = await supabase
    .from('vehicle_documents')
    .select('id, doc_type, storage_path, expiry_date, created_at, profiles(first_name, last_name)')
    .eq('vehicle_id', vehicle.id)
    .order('created_at', { ascending: false })

  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'heic', 'webp']
  const documents: VehicleDocument[] = await Promise.all(
    (docRows ?? []).map(async (d) => {
      const fileName = d.storage_path.split('/').pop() ?? d.storage_path
      const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrl(d.storage_path, 60 * 60)
      return {
        id: d.id,
        type: (d.doc_type ?? 'other') as VehicleDocType,
        storagePath: d.storage_path,
        fileName: fileName.replace(/^\d{10,}-/, ''),
        isImage: IMAGE_EXT.includes(ext),
        signedUrl: signed?.signedUrl ?? null,
        expiryDate: d.expiry_date,
        createdAtLabel: formatDateTime(d.created_at, profile),
        uploaderName: d.profiles
          ? [d.profiles.first_name, d.profiles.last_name].filter(Boolean).join(' ') || null
          : null,
      }
    })
  )

  // ─── Load history ───
  const { data: loadsData } = await supabase
    .from('loads')
    .select('id, load_number, status, pickup_city, pickup_state, delivery_city, delivery_state, delivery_date, total_miles, rate')
    .eq('vehicle_id', vehicle.id)
    .order('delivery_date', { ascending: false, nullsFirst: false })

  const loads = loadsData ?? []
  const totalLoads = loads.length
  const totalMiles = loads.reduce((sum, l) => sum + (l.total_miles ?? 0), 0)
  const totalRevenue = loads.reduce((sum, l) => sum + (Number(l.rate) || 0), 0)
  const avgPerLoad = totalLoads > 0 ? totalRevenue / totalLoads : 0

  const { data: carrierOrg } = await supabase
    .from('organizations')
    .select('currency')
    .eq('id', profile.org_id)
    .maybeSingle()

  // ─── Maintenance ───
  const [{ data: remindersData }, { data: logsData }] = await Promise.all([
    supabase
      .from('maintenance_reminders')
      .select('id, reminder_type, trigger_miles, trigger_months, last_service_date, last_odometer, next_due_date, next_due_miles, is_active')
      .eq('vehicle_id', vehicle.id)
      .eq('is_active', true)
      .order('next_due_date', { ascending: true, nullsFirst: false }),
    supabase
      .from('service_logs')
      .select('id, service_type, service_date, odometer, cost, shop_name, notes, receipt_path')
      .eq('vehicle_id', vehicle.id)
      .order('service_date', { ascending: false }),
  ])

  const reminders = remindersData ?? []
  const serviceLogs = logsData ?? []

  const serviceLogsWithReceipt = await Promise.all(
    serviceLogs.map(async (log) => {
      if (!log.receipt_path) return { ...log, receiptUrl: null as string | null }
      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrl(log.receipt_path, 60 * 60)
      return { ...log, receiptUrl: signed?.signedUrl ?? null }
    })
  )

  // ─── Fuel stops ─── (audit gap #13 cluster: ungated on all tiers, see
  // schema.sql's own comment on fuel_stops — only fuel_analytics on top
  // of this raw log is Pro+.)
  const { data: fuelStopsData } = await supabase
    .from('fuel_stops')
    .select('id, state, station, stop_date, gallons, price_per_gallon, total_cost, odometer, drivers(profiles(first_name, last_name))')
    .eq('vehicle_id', vehicle.id)
    .order('stop_date', { ascending: false })

  const fuelStops: FuelStopRow[] = (fuelStopsData ?? []).map((f) => ({
    id: f.id,
    state: f.state,
    station: f.station,
    stopDate: f.stop_date,
    gallons: Number(f.gallons),
    pricePerGallon: f.price_per_gallon != null ? Number(f.price_per_gallon) : null,
    totalCost: Number(f.total_cost),
    odometer: f.odometer,
    driverName: f.drivers?.profiles
      ? [f.drivers.profiles.first_name, f.drivers.profiles.last_name].filter(Boolean).join(' ') || null
      : null,
  }))

  const canLogFuel = ['owner', 'solo', 'dispatcher'].includes(profile.role)

  // ─── DVIRs ───
  const { data: dvirData } = await supabase
    .from('dvir_inspections')
    .select('id, type, condition, odometer, signature_url, submitted_at, drivers(profiles(first_name, last_name)), dvir_defects(id, area, description, severity)')
    .eq('vehicle_id', vehicle.id)
    .order('submitted_at', { ascending: false })

  const dvirs = dvirData ?? []
  const dvirSignatureUrls = new Map<number, string>()
  const dvirsWithSignature = dvirs.filter((d) => d.signature_url)
  if (dvirsWithSignature.length > 0) {
    const results = await Promise.allSettled(
      dvirsWithSignature.map((d) => storage.getSignedUrl(d.signature_url!, 60 * 60))
    )
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        dvirSignatureUrls.set(dvirsWithSignature[i].id, res.value)
      }
    })
  }

  const ymm = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
  const label = vehicle.nickname ? `${vehicle.vehicle_number} — ${vehicle.nickname}` : (vehicle.vehicle_number ?? '')

  // ─── Tab content ───

  const detailsTab = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('vehicleDetails')}</h2></CardHeader>
          <CardBody>
            <InfoRow label={t('nickname')} value={vehicle.nickname} />
            <InfoRow label={t('yearMakeModel')} value={ymm || null} />
            <InfoRow label={t('vin')} value={vehicle.vin} />
            <InfoRow label={t('licensePlate')} value={[vehicle.license_plate, vehicle.license_state].filter(Boolean).join(' / ') || null} />
            <InfoRow label={t('type')} value={vt ? t(`type_${vt.code}` as never) : null} />
            <InfoRow label={t('cabType')} value={vehicle.cab_type ? t(`cabType_${vehicle.cab_type}` as never) : null} />
            <InfoRow label={t('color')} value={vehicle.color} />
            <InfoRow label={t('dimensions')} value={vehicle.dimensions} />
          </CardBody>
        </Card>

        <VehicleDocuments
          documents={documents}
          vehicleId={vehicle.id}
          orgId={profile.org_id}
          userId={user.id}
          canUpload={canManage}
          canDelete={canManage}
        />
      </div>

      <div className="space-y-6">
        <Card>
          <CardBody className="flex flex-col items-center text-center">
            {TypeIcon
              ? <TypeIcon className="w-16 h-16 text-text-sec mb-3" />
              : <span className="material-symbols-outlined text-text-mut text-5xl mb-3">fire_truck</span>}
            <StatusBadge variant={vehicleStatusVariant((vehicle.status ?? 'active') as VehicleStatus)}>
              {t(`vstatus_${vehicle.status ?? 'active'}` as never)}
            </StatusBadge>
          </CardBody>
        </Card>
      </div>
    </div>
  )

  const loadHistoryTab = (
    <div className="space-y-6">
      <div className={`grid grid-cols-2 ${showRate ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-4`}>
        <KpiTile label={t('statTotalLoads')} value={totalLoads} />
        {showRate && (
          <Card>
            <CardBody>
              <p className="text-[10px] font-bold tracking-[0.08em] uppercase text-text-sec mb-2">{t('statRevenue')}</p>
              <p className="text-[26px] font-extrabold tracking-tight text-brand-orange leading-none">{formatMoney(totalRevenue, carrierOrg?.currency ?? 'USD', locale)}</p>
            </CardBody>
          </Card>
        )}
        <KpiTile label={t('statMiles')} value={totalMiles.toLocaleString()} />
        {showRate && (
          <KpiTile label={t('statAvgPerLoad')} value={formatMoney(avgPerLoad, carrierOrg?.currency ?? 'USD', locale)} />
        )}
      </div>

      {loads.length === 0 ? (
        <Card>
          <EmptyState icon="local_shipping" title={t('noLoadsYet')} />
        </Card>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>{t('colLoad')}</TableHeaderCell>
                <TableHeaderCell>{t('colStatus')}</TableHeaderCell>
                <TableHeaderCell>{t('colRoute')}</TableHeaderCell>
                <TableHeaderCell>{t('colDate')}</TableHeaderCell>
                {showRate && <TableHeaderCell numeric>{t('colRate')}</TableHeaderCell>}
              </tr>
            </thead>
            <tbody>
              {loads.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium text-text-pri">
                    <Link href={`/loads/${l.load_number}`} className="hover:text-brand-orange transition-colors rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
                      {l.load_number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge variant={loadStatusVariant((l.status ?? 'draft') as LoadStatus)} size="sm">
                      {tLoads(`status_${l.status ?? 'draft'}` as never)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    {[l.pickup_city, l.pickup_state].filter(Boolean).join(', ')} → {[l.delivery_city, l.delivery_state].filter(Boolean).join(', ')}
                  </TableCell>
                  <TableCell>{l.delivery_date ? formatDate(l.delivery_date, profile) : '—'}</TableCell>
                  {showRate && (
                    <TableCell numeric className="font-medium text-text-pri">
                      {formatMoney(l.rate, carrierOrg?.currency ?? 'USD', locale)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )

  const maintenanceTab = (
    <div className="space-y-6">
      <Card>
        <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('reminders')}</h2></CardHeader>
        {reminders.length === 0 ? (
          <div className="px-5 py-4 text-text-sec text-sm">{t('noRemindersForTruck')}</div>
        ) : (
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>{t('reminderType')}</TableHeaderCell>
                <TableHeaderCell>{t('lastService')}</TableHeaderCell>
                <TableHeaderCell>{t('nextDue')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('status')}</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {reminders.map((r) => {
                const status = computeMaintStatus(r.next_due_date)
                const progress = computeMaintProgress(r)
                const Icon = MAINTENANCE_ICONS[r.reminder_type] ?? MAINTENANCE_ICONS.other
                const nextDue = [
                  r.next_due_date ? formatDate(r.next_due_date, profile) : null,
                  r.next_due_miles ? t('milesValue', { miles: r.next_due_miles.toLocaleString() }) : null,
                ].filter(Boolean).join(' · ') || '—'
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-text-pri">
                      <div className="flex items-center gap-2.5">
                        <Icon className="w-4 h-4 shrink-0 text-text-sec" />
                        {r.reminder_type}
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.last_service_date ? formatDate(r.last_service_date, profile) : t('never')}
                    </TableCell>
                    <TableCell>
                      <div>{nextDue}</div>
                      {progress && (
                        <div className="mt-1.5 w-24">
                          <ProgressBar value={Math.round(progress.pct * 100)} variant={PROGRESS_BAR_VARIANT[progress.status]} thin />
                        </div>
                      )}
                    </TableCell>
                    <TableCell numeric>
                      <StatusBadge variant={MAINT_STATUS_VARIANT[status]} size="sm">
                        {t(`mstatus_${status}`)}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('serviceHistory')}</h2></CardHeader>
        {serviceLogsWithReceipt.length === 0 ? (
          <div className="px-5 py-4 text-text-sec text-sm">{t('noServiceLogsYet')}</div>
        ) : (
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>{t('date')}</TableHeaderCell>
                <TableHeaderCell>{t('serviceType')}</TableHeaderCell>
                <TableHeaderCell>{t('shop')}</TableHeaderCell>
                <TableHeaderCell>{t('odometer')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('cost')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('receipt')}</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {serviceLogsWithReceipt.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{formatDate(log.service_date, profile)}</TableCell>
                  <TableCell className="font-medium text-text-pri">{log.service_type}</TableCell>
                  <TableCell>{log.shop_name ?? '—'}</TableCell>
                  <TableCell>{log.odometer ? log.odometer.toLocaleString() : '—'}</TableCell>
                  <TableCell numeric className="font-medium text-text-pri">{log.cost != null ? formatMoney(log.cost, carrierOrg?.currency ?? 'USD', locale) : '—'}</TableCell>
                  <TableCell numeric>
                    {log.receiptUrl ? (
                      <a href={log.receiptUrl} target="_blank" rel="noreferrer" className="text-[#f97316] hover:underline text-xs font-medium">
                        {t('viewReceipt')}
                      </a>
                    ) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )

  const fuelTab = (
    <FuelStopsSection
      fuelStops={fuelStops}
      vehicleId={vehicle.id}
      orgId={profile.org_id}
      userId={user.id}
      canLog={canLogFuel}
      currency={carrierOrg?.currency ?? 'USD'}
      locale={locale}
    />
  )

  const dvirsTab = (
    <Card>
      {dvirs.length === 0 ? (
        <EmptyState icon="fact_check" title={t('noDvirsYet')} />
      ) : (
        <div className="divide-y divide-divider-ui">
          {dvirs.map((d) => {
            const driverName = d.drivers?.profiles
              ? [d.drivers.profiles.first_name, d.drivers.profiles.last_name].filter(Boolean).join(' ')
              : null
            const defects = d.dvir_defects ?? []
            const hasDefects = d.condition === 'defects_noted' || defects.length > 0
            return (
              <div key={d.id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      d.type === 'pre_trip' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                    }`}>
                      {t(d.type === 'pre_trip' ? 'dvirPreTrip' : 'dvirPostTrip')}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      hasDefects ? 'bg-warning/20 text-warning' : 'bg-success/20 text-success'
                    }`}>
                      {hasDefects ? t('dvirDefectsNoted') : t('dvirSatisfactory')}
                    </span>
                  </div>
                  <span className="text-text-sec text-xs">{formatDateTime(d.submitted_at, profile)}</span>
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs text-text-mut">
                  {driverName && <span>{driverName}</span>}
                  {d.odometer != null && <span>{d.odometer.toLocaleString()} mi</span>}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {dvirSignatureUrls.has(d.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed, expiring Supabase Storage URL, not a static asset next/image can cache
                    <img src={dvirSignatureUrls.get(d.id)} alt="" className="h-8 bg-white rounded border border-divider-ui px-1" />
                  ) : (
                    <span className="text-text-mut text-xs">{t('dvirNotSigned')}</span>
                  )}
                </div>
                {hasDefects && defects.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {defects.map((def) => (
                      <li key={def.id} className="text-text-mut text-xs flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${def.severity === 'major' ? 'bg-danger' : 'bg-warning'}`} />
                        <span className="text-text-sec">{def.area}</span>
                        {def.description && <span>— {def.description}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/vehicles" className="text-text-sec hover:text-text-pri transition rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </Link>
          <h1 className="text-2xl font-semibold text-text-pri">{label}</h1>
          <StatusBadge variant={vehicleStatusVariant((vehicle.status ?? 'active') as VehicleStatus)}>
            {t(`vstatus_${vehicle.status ?? 'active'}` as never)}
          </StatusBadge>
        </div>
        <p className="text-text-sec text-sm ml-9">{ymm || vt ? [ymm, vt ? t(`type_${vt.code}` as never) : null].filter(Boolean).join(' · ') : ''}</p>
        <div className="ml-9 mt-2">
          <VehiclePhotoUpload vehicleId={vehicle.id} orgId={profile.org_id} photoUrl={photoUrl} canUpload={canManage} />
        </div>
      </div>

      <VehicleTabs
        tabs={[
          { key: 'details', content: detailsTab },
          { key: 'loadHistory', content: loadHistoryTab },
          { key: 'maintenance', content: maintenanceTab },
          { key: 'fuel', content: fuelTab },
          { key: 'dvirs', content: dvirsTab },
        ]}
      />
    </div>
  )
}
