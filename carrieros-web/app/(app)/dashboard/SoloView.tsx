// app/(app)/dashboard/SoloView.tsx
// Hybrid view: a `solo` user is both the owner-equivalent and (often) their
// own driver. If they currently have an active load assigned to them, show
// a compact "My Load Today" card above the full owner content; otherwise
// just render the owner content — no point showing an empty driver card
// when they aren't currently driving anything.
import { createClient } from '@/lib/supabase/server'
import { getTranslations } from 'next-intl/server'
import MyLoadCard, { type MyLoad } from './MyLoadCard'
import OwnerView from './OwnerView'
import { getDriverIdForProfile } from '@/lib/queries/drivers'
import { getActiveLoadForDriver } from '@/lib/queries/loads'

export default async function SoloView({ userId, orgId }: { userId: string; orgId: number | undefined }) {
  const supabase = await createClient()
  const t = await getTranslations('dashboard')
  const tLoads = await getTranslations('loads')

  // Same driver-scoping pattern as app/(app)/loads/page.tsx and DriverView:
  // resolve this profile's own drivers row, then look for an active load.
  const { data: driver } = await getDriverIdForProfile(supabase, userId)

  let activeLoad: MyLoad | null = null
  if (driver) {
    const { data: loadRows } = await getActiveLoadForDriver(supabase, driver.id)
    activeLoad = (loadRows && loadRows[0]) ?? null
  }

  return (
    <div className="p-8">
      {activeLoad && (
        <MyLoadCard
          load={activeLoad}
          title={t('myLoadToday')}
          noActiveLoadLabel={t('noActiveLoad')}
          statusLabel={(status) => tLoads(`status_${status}`)}
          compact
        />
      )}
      <OwnerView orgId={orgId} embedded />
    </div>
  )
}
