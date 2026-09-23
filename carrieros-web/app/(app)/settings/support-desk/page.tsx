// app/(app)/settings/support-desk/page.tsx
// Enterprise org_support ticket queue staff console (decisions.md T16) — owner/solo only
// (org_support_manage, migration 0027), same gate shape as app/(app)/settings/branding/page.tsx and
// app/(app)/billing/page.tsx.
//
// Not redirected away when the org isn't Enterprise-entitled — shown as a locked upsell state
// instead (loss-aversion framing, decisions.md PR3), same pattern branding's page already uses.
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'
import { hasFeature } from '@/lib/entitlements'
import { Card, CardBody } from '@/components/ui'
import SupportDeskConsole from './SupportDeskConsole'

export default async function SupportDeskPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id) redirect('/onboarding')
  if (!roleHasCapability(profile.role, 'org_support_manage')) redirect('/settings')

  const enabled = await hasFeature(supabase, 'support_desk')
  const t = await getTranslations('supportDesk')

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h1 className="text-text-pri text-xl font-semibold mb-1">{t('title')}</h1>
      <p className="text-text-sec text-sm mb-8">{t('subtitle')}</p>

      {!enabled ? (
        <Card>
          <CardBody className="text-center py-10">
            <span className="material-symbols-outlined text-text-mut text-4xl">lock</span>
            <h2 className="text-text-pri font-medium text-base mt-3">{t('lockedTitle')}</h2>
            <p className="text-text-sec text-sm mt-2 max-w-sm mx-auto">{t('lockedDescription')}</p>
            <Link
              href="/billing"
              className="inline-flex items-center gap-1 mt-4 text-sm font-semibold text-brand-orange hover:underline"
            >
              {t('upgradeCta')}
            </Link>
          </CardBody>
        </Card>
      ) : (
        <SupportDeskConsole />
      )}
    </div>
  )
}
