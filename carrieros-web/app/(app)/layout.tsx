// app/(app)/layout.tsx
// Shared layout for all authenticated pages — provides dark shell + sidebar
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/Sidebar'
import { getProfileForUser } from '@/lib/queries/profiles'
import { getOrgBranding } from '@/lib/branding'
import { brandingCssVars } from '@/lib/domain/branding'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)
  const t = await getTranslations('common')

  const role = profile?.role ?? 'solo'
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user.email || t('userFallback')
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

  // Enterprise branding customization (decisions.md PR1 amendment) — the
  // ONE resolver (lib/branding.ts) for the app shell's logo/brand colors.
  // brandingCssVars() maps them onto the same --color-brand-orange/
  // --color-teal custom properties app/globals.css's @theme block already
  // generates bg-brand-orange/text-brand-orange/bg-teal/text-teal utilities
  // from, so setting them here on the outer wrapper cascades to every
  // authenticated page without touching a single component.
  const branding = await getOrgBranding(supabase)
  const brandingStyle = brandingCssVars(branding)

  return (
    <div
      className="flex h-screen bg-navy overflow-hidden"
      style={brandingStyle as React.CSSProperties}
    >
      <Sidebar
        role={role}
        userName={name}
        userId={user.id}
        preferredLanguage={preferredLanguage}
        roleAbbreviation={roleRow?.abbreviation}
        roleColorToken={roleRow?.color_token}
        logoUrl={branding.logoUrl}
      />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
