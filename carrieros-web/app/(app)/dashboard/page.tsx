// app/(app)/dashboard/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import OwnerView from './OwnerView'
import SoloView from './SoloView'
import DriverView from './DriverView'
import DispatcherView from './DispatcherView'
import FinanceView from './FinanceView'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, first_name, last_name, org_id')
    .eq('id', user.id)
    .single()

  const role  = profile?.role ?? 'solo'
  const orgId = profile?.org_id

  const t = await getTranslations('dashboard')
  const tNav = await getTranslations('nav')
  const locale = await getLocale()

  return (
    <div>
      <div className="px-8 pt-8">
        <h1 className="text-2xl font-semibold text-white">
          {role === 'owner' || role === 'solo' ? t('title') : tNav('dashboard')}
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          {new Date().toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {role === 'owner' && <OwnerView orgId={orgId} />}
      {role === 'solo' && <SoloView userId={user.id} orgId={orgId} />}
      {role === 'driver' && <DriverView userId={user.id} />}
      {role === 'dispatcher' && <DispatcherView orgId={orgId} />}
      {role === 'finance' && <FinanceView orgId={orgId} />}
    </div>
  )
}
