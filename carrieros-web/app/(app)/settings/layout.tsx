// app/(app)/settings/layout.tsx
// Shared tab bar for every /settings/* page (Profile, Security, Developer API, Integrations,
// Branding, Support Desk) — collapses what used to be 6 separate flat Sidebar entries (out of an
// 8-item "Team" section that had nothing to do with team management) into one Sidebar entry with an
// in-page tab strip. Capability-filtered exactly like Sidebar.tsx's own items were, so nobody sees a
// tab for a page they couldn't open anyway.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability, type RoleCapability } from '@/lib/generated/role-capabilities'
import SettingsNav, { type SettingsTabItem } from './SettingsNav'

const TAB_ITEMS: (SettingsTabItem & { capability: RoleCapability })[] = [
  { labelKey: 'settings', href: '/settings', capability: 'settings_view' },
  { labelKey: 'security', href: '/settings/security', capability: 'settings_view' },
  { labelKey: 'developerApi', href: '/settings/developer-api', capability: 'subscription_management' },
  { labelKey: 'integrations', href: '/settings/integrations', capability: 'subscription_management' },
  { labelKey: 'brandingCustomization', href: '/settings/branding', capability: 'org_branding_manage' },
  { labelKey: 'supportDesk', href: '/settings/support-desk', capability: 'org_support_manage' },
]

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)
  const role = profile?.role ?? 'solo'
  const items = TAB_ITEMS.filter((item) => roleHasCapability(role, item.capability))

  return (
    <div>
      {items.length > 1 && <SettingsNav items={items} />}
      {children}
    </div>
  )
}
