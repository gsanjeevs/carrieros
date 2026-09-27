import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getDriverIdForProfile } from '@/lib/queries/drivers'
import { getActiveLoadForDriver } from '@/lib/queries/loads'
import MyLoadCard, { type MyLoad } from '../dashboard/MyLoadCard'

export default async function MyLoadsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const t = await getTranslations('loads')
  const tDashboard = await getTranslations('dashboard')
  const { data: driver } = await getDriverIdForProfile(supabase, user.id)
  const { data: activeRows } = driver ? await getActiveLoadForDriver(supabase, driver.id) : { data: [] as MyLoad[] }
  const activeLoad = (activeRows?.[0] as MyLoad | undefined) ?? null

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold text-text-pri">{t('myLoadsTitle')}</h1>
      <div className="mb-8" />
      <MyLoadCard
        load={activeLoad}
        title={tDashboard('myLoadToday')}
        noActiveLoadLabel={tDashboard('noActiveLoad')}
        statusLabel={(status) => t(`status_${status}` as never)}
      />
    </div>
  )
}
