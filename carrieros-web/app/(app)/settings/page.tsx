// app/(app)/settings/page.tsx
// Personal profile settings — language, units, date/time format. All fields
// here are per-user (profiles table), not per-company (decisions.md L2:
// personal prefs follow the user). uom_system is nullable — null means
// "inherit the carrier's default" from carrier_details.
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import ProfileSettingsForm from './ProfileSettingsForm'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import { Card, CardBody } from '@/components/ui'
import { getProfileForUser } from '@/lib/queries/profiles'
import { isThemePreference } from '@/lib/theme'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  let orgDefaultUom: 'imperial' | 'metric' = 'imperial'
  if (profile?.org_id) {
    const { data: details } = await supabase
      .from('carrier_details')
      .select('uom_system')
      .eq('org_id', profile.org_id)
      .maybeSingle()
    if (details?.uom_system) orgDefaultUom = details.uom_system as 'imperial' | 'metric'
  }

  const t = await getTranslations('settings')
  const themePreference = isThemePreference(profile?.theme_preference) ? profile.theme_preference : 'system'

  return (
    // This page is the app's proof surface for decisions.md V3's "the main
    // content surface area switches" — bg-surface-page is the semantic
    // token app/layout.tsx's `dark` class (or its absence) actually
    // controls, deliberately applied here (edge-to-edge, not just inside
    // the Card) rather than on the shared app/(app)/layout.tsx shell, which
    // still holds many pages built on literal dark Tailwind classes
    // (text-white, bg-navy, ...) that don't respond to this token at all —
    // flipping the shared shell's background out from under those would
    // make them illegible (dark literal text on a light ambient
    // background), not actually theme them. Converting those pages is
    // real, separate follow-up work — see V3/V6 in decisions.md.
    <div className="min-h-full bg-surface-page">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-text-pri text-xl font-semibold mb-1">{t('title')}</h1>
        <p className="text-text-sec text-sm mb-8">{t('subtitle')}</p>

        <Card className="mb-6">
          <CardBody>
            <ThemeSwitcher current={themePreference} />
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <ProfileSettingsForm
              userId={user.id}
              current={{
                preferred_language: profile?.preferred_language ?? 'en',
                uom_system: (profile?.uom_system as 'imperial' | 'metric' | null) ?? null,
                date_format: profile?.date_format ?? 'MM/DD/YYYY',
                time_format: profile?.time_format ?? '12h',
              }}
              orgDefaultUom={orgDefaultUom}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
