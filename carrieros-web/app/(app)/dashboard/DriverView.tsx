// app/(app)/dashboard/DriverView.tsx
// Driver-focused dashboard: not a fleet-management view — a driver isn't
// running a company, they're running a load. Shows their current/most
// recent active load prominently, then their own compliance status.
import { createClient } from '@/lib/supabase/server'
import { getTranslations } from 'next-intl/server'
import MyLoadCard, { type MyLoad } from './MyLoadCard'

const COMPLIANCE_DUE_SOON_DAYS = 30
const ACTIVE_STATUSES = ['dispatched', 'picked_up', 'in_transit']

export default async function DriverView({ userId }: { userId: string }) {
  const supabase = await createClient()
  const t = await getTranslations('dashboard')
  const tLoads = await getTranslations('loads')

  const { data: driver } = await supabase
    .from('drivers')
    .select('id, cdl_expiry, med_cert_expiry')
    .eq('profile_id', userId)
    .single()

  let activeLoad: MyLoad | null = null
  if (driver) {
    const { data: loadRows } = await supabase
      .from('loads')
      .select('load_number, status, pickup_city, pickup_state, delivery_city, delivery_state, customer_name_raw')
      .eq('driver_id', driver.id)
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
    activeLoad = (loadRows && loadRows[0]) ?? null
  }

  // Same compliance bucketing as OwnerView's driver-fleet breakdown, but
  // scoped to just this one driver.
  const now = new Date()
  const dueSoonCutoff = new Date(now.getTime() + COMPLIANCE_DUE_SOON_DAYS * 24 * 60 * 60 * 1000)

  let complianceLabel = t('complianceIncomplete')
  let complianceColor = '#dc2626'
  if (driver?.cdl_expiry && driver?.med_cert_expiry) {
    const cdl = new Date(driver.cdl_expiry)
    const med = new Date(driver.med_cert_expiry)
    if (cdl <= dueSoonCutoff || med <= dueSoonCutoff) {
      complianceLabel = t('complianceDueSoon')
      complianceColor = '#d97706'
    } else {
      complianceLabel = t('complianceClear')
      complianceColor = '#16a34a'
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <MyLoadCard
        load={activeLoad}
        title={t('myLoadToday')}
        noActiveLoadLabel={t('noActiveLoad')}
        statusLabel={(status) => tLoads(`status_${status}`)}
      />

      <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
        <div className="flex items-start justify-between mb-3">
          <span className="text-slate-400 text-sm font-medium">{t('driverCompliance')}</span>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#3b82f620' }}>
            <span className="material-symbols-outlined text-[18px]" style={{ color: '#3b82f6' }}>person</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: complianceColor }} />
          <span className="text-white text-sm font-medium">{complianceLabel}</span>
        </div>
      </div>
    </div>
  )
}
