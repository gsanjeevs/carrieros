// app/(app)/settings/branding/page.tsx
// Enterprise branding customization (decisions.md PR1 amendment) — logo +
// a small set of brand-color overrides, applied to the app shell and the
// public tracking page. Owner/solo only (org_branding_manage, migration
// 0026), same gate shape as app/(app)/billing/page.tsx and
// app/(app)/settings/developer-api/page.tsx.
//
// Not redirected away when the org isn't Enterprise-entitled — shown as a
// locked upsell state instead (loss-aversion framing, decisions.md PR3),
// same inline-teaser shape app/(app)/customers/[customer_number]/page.tsx
// already uses for customer_health_score rather than a bare redirect.
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'
import { getOrgBranding } from '@/lib/branding'
import { Card, CardBody, Callout } from '@/components/ui'
import BrandingForm from './BrandingForm'

export default async function BrandingSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id) redirect('/onboarding')
  if (!roleHasCapability(profile.role, 'org_branding_manage')) redirect('/settings')

  const branding = await getOrgBranding(supabase)
  const t = await getTranslations('brandingSettings')

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h1 className="text-text-pri text-xl font-semibold mb-1">{t('title')}</h1>
      <p className="text-text-sec text-sm mb-8">{t('subtitle')}</p>

      {!branding.enabled ? (
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
        <>
          <Callout tone="info" className="mb-6">
            {t('tierNote')}
          </Callout>
          <Card>
            <CardBody>
              <BrandingForm
                current={{
                  logoUrl: branding.logoUrl,
                  primaryColor: branding.primaryColor,
                  accentColor: branding.accentColor,
                }}
              />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
