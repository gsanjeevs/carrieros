// app/(app)/settings/security/page.tsx
// Passkey/WebAuthn management (decisions.md T15 — web build; mobile is
// native-bridge work, explicitly out of scope). No capability gate: every
// tenant role holds `settings_view` and this page mirrors ../page.tsx's own
// guard (session only), and unlike developer-api this isn't an
// administration action — every signed-in user manages their own
// credentials, same as ProfileSettingsForm. ShipmentX platform-staff (sx_*)
// profiles reach this URL too (nothing in proxy.ts's ROLE_ROUTES guards
// /settings), which matters for T15's "every role, including SuperAdmin"
// framing — though there's currently no admin-console nav link to it; see
// this session's report for that gap.
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import PasskeySettings from './PasskeySettings'
import { Card, CardBody } from '@/components/ui'

export default async function SecuritySettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const t = await getTranslations('security')

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h1 className="text-text-pri text-xl font-semibold mb-1">{t('title')}</h1>
      <p className="text-text-sec text-sm mb-8">{t('subtitle')}</p>

      <Card>
        <CardBody>
          <PasskeySettings />
        </CardBody>
      </Card>
    </div>
  )
}
