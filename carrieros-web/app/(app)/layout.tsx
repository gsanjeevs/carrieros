// app/(app)/layout.tsx
// Shared layout for all authenticated pages — provides dark shell + sidebar
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/Sidebar'
import { getProfileForUser } from '@/lib/queries/profiles'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  const role = profile?.role ?? 'solo'
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user.email || 'User'
  const preferredLanguage = profile?.preferred_language ?? 'en'

  // roles is master data (abbreviation + color_token for the sidebar badge) —
  // fetched here, server-side, and prop-drilled down rather than queried from
  // the client Sidebar component, matching how preferredLanguage/role are
  // already passed down.
  const { data: roleRow } = await supabase
    .from('roles')
    .select('abbreviation, color_token')
    .eq('code', role)
    .single()

  return (
    <div className="flex h-screen bg-navy overflow-hidden">
      <Sidebar
        role={role}
        userName={name}
        userId={user.id}
        preferredLanguage={preferredLanguage}
        roleAbbreviation={roleRow?.abbreviation}
        roleColorToken={roleRow?.color_token}
      />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
