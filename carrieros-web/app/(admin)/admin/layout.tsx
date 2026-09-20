// app/(admin)/admin/layout.tsx
// Shared shell for the ShipmentX platform-staff surface (audit gap #14).
// A sibling route group to app/(app)/ — deliberately NOT nested under it,
// so platform staff never see the tenant Sidebar (Loads/Dispatch/etc, none
// of which apply to an sx_* profile). proxy.ts's ROLE_ROUTES already
// restricts the /admin prefix to sx_owner/sx_finance/sx_support and
// bounces anyone else to their own tenant home; this layout adds the same
// check server-side as defense in depth (matching every other role gate
// in this codebase — proxy.ts is not the only place a check lives).
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/AdminSidebar'
import { getProfileForUser } from '@/lib/queries/profiles'

const SX_ROLES = ['sx_owner', 'sx_finance', 'sx_support']

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile || !SX_ROLES.includes(profile.role)) redirect('/dashboard')

  const t = await getTranslations('common')
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || user.email || t('adminFallback')

  return (
    <div className="flex h-screen bg-surface-page overflow-hidden">
      <AdminSidebar role={profile.role} userName={name} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
