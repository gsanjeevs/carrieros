// app/(app)/drivers/[driver_number]/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import DriverTabs from './DriverTabs'
import DriverDocuments, { type DriverDocType, type DriverDocument } from '@/components/DriverDocuments'
import DriverPayConfig from '@/components/DriverPayConfig'
import { formatDate, formatDateTime } from '@/lib/format-datetime'
import { formatMoney } from '@/lib/format-money'
import { inviteStatusVariant, type InviteStatus } from '@/lib/domain/invite-status'
import { loadStatusVariant, type LoadStatus } from '@/lib/domain/load-status'
import { cdlGlowStatus } from '@/lib/domain/driver-compliance'
import StatusBadge from '@/components/ui/StatusBadge'

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-white/5 last:border-0">
      <span className="text-slate-500 text-sm">{label}</span>
      <span className="text-white text-sm text-right ml-4">{value ?? '—'}</span>
    </div>
  )
}

export default async function DriverDetailPage({
  params,
}: {
  params: Promise<{ driver_number: string }>
}) {
  const { driver_number } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role, date_format, time_format')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) redirect('/onboarding')

  const t = await getTranslations('drivers')
  const locale = await getLocale()

  // Fetch driver
  const { data: driverRow } = await supabase
    .from('drivers')
    .select(`
      *,
      profiles ( first_name, last_name, phone, avatar_path ),
      vehicles ( id, vehicle_number, nickname )
    `)
    .eq('driver_number', driver_number)
    .eq('carrier_org_id', profile.org_id)
    .single()

  if (!driverRow) notFound()
  const driver = driverRow

  const canManage = ['owner', 'solo'].includes(profile.role)
  const showRate = ['owner', 'solo', 'finance'].includes(profile.role)

  const driverName = [driver.profiles?.first_name, driver.profiles?.last_name].filter(Boolean).join(' ') || driver.driver_number || '—'
  const initials = driverName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  // Avatar — mobile-captured only, nullable, no web upload UI. Signed URL
  // from the (not-yet-guaranteed-to-exist) 'avatars' bucket; fall back to
  // initials silently if the bucket/object isn't there.
  let avatarUrl: string | null = null
  if (driver.profiles?.avatar_path) {
    const { data: signedAvatar } = await supabase.storage
      .from('avatars')
      .createSignedUrl(driver.profiles.avatar_path, 60 * 60)
    avatarUrl = signedAvatar?.signedUrl ?? null
  }

  // ─── Documents ───
  const { data: docRows } = await supabase
    .from('driver_documents')
    .select('id, doc_type, storage_path, expiry_date, created_at, profiles(first_name, last_name)')
    .eq('driver_id', driver.id)
    .order('created_at', { ascending: false })

  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'heic', 'webp']
  const documents: DriverDocument[] = await Promise.all(
    (docRows ?? []).map(async (d) => {
      const fileName = d.storage_path.split('/').pop() ?? d.storage_path
      const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrl(d.storage_path, 60 * 60)
      return {
        id: d.id,
        type: (d.doc_type ?? 'other') as DriverDocType,
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

  // ─── Loads ───
  const { data: loadsData } = await supabase
    .from('loads')
    .select('id, load_number, status, pickup_city, pickup_state, delivery_city, delivery_state, delivery_date, total_miles, rate')
    .eq('driver_id', driver.id)
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

  // ─── DVIRs ───
  const { data: dvirData } = await supabase
    .from('dvir_inspections')
    .select('id, type, condition, odometer, submitted_at, vehicles(vehicle_number, nickname), dvir_defects(id, area, description, severity)')
    .eq('driver_id', driver.id)
    .order('submitted_at', { ascending: false })

  const dvirs = dvirData ?? []

  const glow = cdlGlowStatus(driver.cdl_expiry)
  const glowDotClass =
    glow === 'success' ? 'bg-[#16a34a] shadow-glow-success' :
    glow === 'warning' ? 'bg-amber-500 shadow-glow-warning' :
    'bg-rose-500 shadow-glow-danger'
  const inviteStatus = (driver.invite_status ?? 'pending') as InviteStatus

  const vehicleLabel = driver.vehicles
    ? `${driver.vehicles.vehicle_number ?? ''}${driver.vehicles.nickname ? ` — ${driver.vehicles.nickname}` : ''}`.trim()
    : null

  // ─── Tab content ───

  const profileTab = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
          <h2 className="text-white font-medium text-sm mb-3">{t('driverDetails')}</h2>
          <InfoRow label={t('driverNumber')} value={driver.driver_number} />
          <InfoRow label={t('phone')} value={driver.profiles?.phone} />
          <InfoRow label={t('defaultTruck')} value={vehicleLabel ?? t('noDefaultTruck')} />
        </div>

        <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
          <h2 className="text-white font-medium text-sm mb-3">{t('emergencyContact')}</h2>
          {driver.emergency_contact_name || driver.emergency_contact_phone ? (
            <>
              <InfoRow label={t('emergencyContactName')} value={driver.emergency_contact_name} />
              <InfoRow label={t('emergencyContactPhone')} value={driver.emergency_contact_phone} />
              <InfoRow
                label={t('emergencyContactRelation')}
                value={driver.emergency_contact_relation}
              />
            </>
          ) : (
            <p className="text-slate-500 text-sm">{t('noEmergencyContact')}</p>
          )}
        </div>

        {canManage && (
          <DriverPayConfig
            driverId={driver.id}
            settlementType={driver.settlement_type as 'percent_of_rate' | 'per_mile' | 'flat_per_load' | null}
            settlementRate={driver.settlement_rate != null ? Number(driver.settlement_rate) : null}
          />
        )}
      </div>

      <div className="space-y-6">
        <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark flex flex-col items-center text-center">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={driverName} className="w-16 h-16 rounded-full object-cover mb-3" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-navy-light flex items-center justify-center mb-3">
              <span className="text-avatar-text text-lg font-semibold">{initials}</span>
            </div>
          )}
          <p className="text-white text-sm font-medium">{driverName}</p>
          <span className="mt-2">
            <StatusBadge variant={inviteStatusVariant(inviteStatus)}>
              {t(`inviteStatus_${driver.invite_status}` as never)}
            </StatusBadge>
          </span>
        </div>

        <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
          <h2 className="text-white font-medium text-sm mb-3">{t('cdlAndMedical')}</h2>
          <div className="inline-flex flex-col gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 w-full">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 text-2xs font-semibold tracking-wide">
                {driver.cdl_class ? t('cdlClass', { class: driver.cdl_class }) : t('cdlClassUnknown')}
              </span>
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${glowDotClass}`}
                style={{
                  boxShadow:
                    glow === 'success' ? 'var(--shadow-glow-success)' :
                    glow === 'warning' ? 'var(--shadow-glow-warning)' :
                    'var(--shadow-glow-danger)',
                }}
              />
            </div>
            <div className="text-slate-400 text-xs">
              {driver.cdl_number ? `${driver.cdl_number} · ` : ''}
              {driver.cdl_state ? `${driver.cdl_state} · ` : ''}
              {driver.cdl_expiry ? formatDate(driver.cdl_expiry, profile) : '—'}
            </div>
            {driver.endorsements && driver.endorsements.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {driver.endorsements.map((code: string) => (
                  <span
                    key={code}
                    className="inline-flex items-center px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/5 text-amber-400 text-2xs font-medium"
                  >
                    {t.has(`endorsement_${code}`) ? t(`endorsement_${code}` as never) : code}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3">
            <InfoRow label={t('medCertExpiry')} value={driver.med_cert_expiry ? formatDate(driver.med_cert_expiry, profile) : null} />
          </div>
        </div>
      </div>
    </div>
  )

  const documentsTab = (
    <DriverDocuments
      documents={documents}
      driverId={driver.id}
      orgId={profile.org_id}
      userId={user.id}
      canUpload={canManage}
      canDelete={canManage}
    />
  )

  const loadsTab = (
    <div className="space-y-6">
      <div className={`grid grid-cols-2 ${showRate ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-4`}>
        <div className="bg-white/5 border border-white/8 rounded-xl p-4 shadow-card-dark">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{t('statTotalLoads')}</p>
          <p className="text-2xl font-semibold text-white">{totalLoads}</p>
        </div>
        {showRate && (
          <div className="bg-white/5 border border-white/8 rounded-xl p-4 shadow-card-dark">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{t('statRevenue')}</p>
            <p className="text-2xl font-semibold text-brand-orange">{formatMoney(totalRevenue, carrierOrg?.currency ?? 'USD', locale)}</p>
          </div>
        )}
        <div className="bg-white/5 border border-white/8 rounded-xl p-4 shadow-card-dark">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{t('statMiles')}</p>
          <p className="text-2xl font-semibold text-white">{totalMiles.toLocaleString()}</p>
        </div>
        {showRate && (
          <div className="bg-white/5 border border-white/8 rounded-xl p-4 shadow-card-dark">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{t('statAvgPerLoad')}</p>
            <p className="text-2xl font-semibold text-white">{formatMoney(avgPerLoad, carrierOrg?.currency ?? 'USD', locale)}</p>
          </div>
        )}
      </div>

      {loads.length === 0 ? (
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center shadow-card-dark">
          <span className="material-symbols-outlined text-slate-600 text-4xl">local_shipping</span>
          <p className="text-slate-500 text-sm mt-3">{t('noLoadsYet')}</p>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('colLoad')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('colStatus')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('colRoute')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('colDate')}</th>
                {showRate && <th className="text-right px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('colRate')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loads.map((l) => (
                <tr key={l.id} className="hover:bg-white/[0.07] transition-colors duration-150">
                  <td className="px-5 py-3">
                    <Link href={`/loads/${l.load_number}`} className="text-white font-medium hover:text-[#f97316] transition-colors rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
                      {l.load_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge variant={loadStatusVariant((l.status ?? 'draft') as LoadStatus)} size="sm">
                      {l.status ?? 'draft'}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {[l.pickup_city, l.pickup_state].filter(Boolean).join(', ')} → {[l.delivery_city, l.delivery_state].filter(Boolean).join(', ')}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{l.delivery_date ? formatDate(l.delivery_date, profile) : '—'}</td>
                  {showRate && (
                    <td className="px-5 py-3 text-right text-white font-medium">
                      {formatMoney(l.rate, carrierOrg?.currency ?? 'USD', locale)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  const dvirsTab = (
    <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
      {dvirs.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <span className="material-symbols-outlined text-slate-600 text-4xl">fact_check</span>
          <p className="text-slate-500 text-sm mt-3">{t('noDvirsYet')}</p>
        </div>
      ) : (
        <div className="divide-y divide-white/5">
          {dvirs.map((d) => {
            const vehicleTag = d.vehicles
              ? `${d.vehicles.vehicle_number ?? ''}${d.vehicles.nickname ? ` — ${d.vehicles.nickname}` : ''}`.trim()
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
                      hasDefects ? 'bg-amber-500/20 text-amber-400' : 'bg-[#16a34a]/20 text-[#16a34a]'
                    }`}>
                      {hasDefects ? t('dvirDefectsNoted') : t('dvirSatisfactory')}
                    </span>
                  </div>
                  <span className="text-slate-500 text-xs">{formatDateTime(d.submitted_at, profile)}</span>
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                  {vehicleTag && <span>{vehicleTag}</span>}
                  {d.odometer != null && <span>{d.odometer.toLocaleString()} mi</span>}
                </div>
                {hasDefects && defects.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {defects.map((def) => (
                      <li key={def.id} className="text-slate-400 text-xs flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${def.severity === 'major' ? 'bg-red-500' : 'bg-amber-500'}`} />
                        <span className="text-slate-300">{def.area}</span>
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
    </div>
  )

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/drivers" className="text-slate-500 hover:text-white transition rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </Link>
          <h1 className="text-2xl font-semibold text-white">{driverName}</h1>
          <StatusBadge variant={inviteStatusVariant(inviteStatus)}>
            {t(`inviteStatus_${driver.invite_status}` as never)}
          </StatusBadge>
        </div>
        <p className="text-slate-400 text-sm ml-9">{driver.driver_number}</p>
      </div>

      <DriverTabs
        tabs={[
          { key: 'profile', content: profileTab },
          { key: 'documents', content: documentsTab },
          { key: 'loads', content: loadsTab },
          { key: 'dvirs', content: dvirsTab },
        ]}
      />
    </div>
  )
}
