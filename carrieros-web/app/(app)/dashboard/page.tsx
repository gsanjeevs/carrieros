// app/(app)/dashboard/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import OwnerView from './OwnerView'
import SoloView from './SoloView'
import DriverView from './DriverView'
import DispatcherView from './DispatcherView'
import FinanceView from './FinanceView'
import { getProfileForUser } from '@/lib/queries/profiles'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  const role  = profile?.role ?? 'solo'
  const orgId = profile?.org_id

  const t = await getTranslations('dashboard')
  const tNav = await getTranslations('nav')
  const locale = await getLocale()

  // Rule A (docs/architecture-principles.md) — this used to be five sibling
  // `{role === 'x' && <View/>}` checks with no fallback, so any role outside
  // that original five (found this session: the new sx_owner/sx_finance/
  // sx_support ShipmentX roles, and pre-existing: customer_admin/
  // customer_viewer) silently rendered a blank page body below the header,
  // no error anywhere. `hasKnownView` makes the missing case visible instead.
  const hasKnownView =
    role === 'owner' || role === 'solo' || role === 'driver' ||
    role === 'dispatcher' || role === 'finance'

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
      {!hasKnownView && (
        <div className="px-8 py-6">
          <p className="text-slate-400 text-sm">{t('noViewForRole')}</p>
        </div>
      )}
    </div>
  )
}
