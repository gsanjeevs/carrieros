// app/(app)/dashboard/DriverView.tsx
// Driver-focused dashboard: not a fleet-management view — a driver isn't
// running a company, they're running a load. Shows their current/most
// recent active load prominently, then their own compliance status.
import { createClient } from '@/lib/supabase/server'
import { getTranslations } from 'next-intl/server'
import MyLoadCard, { type MyLoad } from './MyLoadCard'
import { Card } from '@/components/ui'
import { BRAND_BLUE, DANGER, SUCCESS, WARNING } from '@/lib/design-tokens'

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
  let complianceColor = DANGER
  if (driver?.cdl_expiry && driver?.med_cert_expiry) {
    const cdl = new Date(driver.cdl_expiry)
    const med = new Date(driver.med_cert_expiry)
    if (cdl <= dueSoonCutoff || med <= dueSoonCutoff) {
      complianceLabel = t('complianceDueSoon')
      complianceColor = WARNING
    } else {
      complianceLabel = t('complianceClear')
      complianceColor = SUCCESS
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

      <Card className="p-5">
        <div className="flex items-start justify-between mb-3">
          <span className="text-text-sec text-sm font-medium">{t('driverCompliance')}</span>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${BRAND_BLUE}20` }}>
            <span className="material-symbols-outlined text-[18px]" style={{ color: BRAND_BLUE }}>person</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: complianceColor }} />
          <span className="text-text-pri text-sm font-medium">{complianceLabel}</span>
        </div>
      </Card>
    </div>
  )
}
