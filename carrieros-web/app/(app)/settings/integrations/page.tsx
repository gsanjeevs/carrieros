// app/(app)/settings/integrations/page.tsx
// Org-level outbound webhooks (Integrations) — owner/solo only, same gate as
// billing and Developer API (subscription_management): registering a URL
// that receives every subscribed event for the org is an administration
// action, not one dispatchers or finance should reach.
//
// A Server Component reading via server/composition in-process, per ADR
// 0003 — the SAME WebhookService the write endpoints (/api/v1/webhooks) use,
// mirroring app/(app)/settings/developer-api/page.tsx exactly.
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { createWebhookService, createTelematicsIntegrationService } from '@/server/composition'
import { formatDate } from '@/lib/format-datetime'
import { Callout, Card, EmptyState, StatusBadge, Table, TableCell, TableHeaderCell, TableRow } from '@/components/ui'
import CreateWebhookButton from './CreateWebhookButton'
import WebhookActions from './WebhookActions'
import TelematicsSection from './TelematicsSection'

export default async function IntegrationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id) redirect('/onboarding')
  if (!roleHasCapability(profile.role, 'subscription_management')) redirect('/dashboard')

  const t = await getTranslations('integrations')

  const actor = await buildActorContext(supabase, user, crypto.randomUUID())
  // FORBIDDEN here would mean the capability check above and WebhookService's own check disagree —
  // treated as "no webhooks" rather than a crash, since the redirect above already covers the real case.
  const webhooks = actor.ok ? await createWebhookService(supabase).list(actor.value) : null
  const rows = webhooks?.ok ? webhooks.value : []

  const telematics = actor.ok ? await createTelematicsIntegrationService(supabase).list(actor.value) : null
  const telematicsRows = telematics?.ok
    ? telematics.value.map((i) => ({ provider: i.provider, enabled: i.enabled, credentialConfigured: i.credentialConfigured }))
    : []

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
          <p className="text-text-sec text-sm mt-1">{t('subtitle')}</p>
        </div>
        <CreateWebhookButton />
      </div>

      <Callout tone="info" className="my-6">
        {t('signatureNote')}
      </Callout>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon="webhook" title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>{t('url')}</TableHeaderCell>
                <TableHeaderCell>{t('events')}</TableHeaderCell>
                <TableHeaderCell>{t('created')}</TableHeaderCell>
                <TableHeaderCell>{t('status')}</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-mono text-xs text-text-pri max-w-xs truncate">{w.url}</TableCell>
                  <TableCell className="text-xs text-text-sec">{w.subscribedEvents.join(', ')}</TableCell>
                  <TableCell>{formatDate(w.createdAt, profile)}</TableCell>
                  <TableCell>
                    <StatusBadge variant={w.enabled ? 'success' : 'neutral'} size="sm">
                      {w.enabled ? t('statusEnabled') : t('statusDisabled')}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-right">
                    <WebhookActions webhook={{ id: w.id, url: w.url, enabled: w.enabled, subscribedEvents: [...w.subscribedEvents] }} />
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <TelematicsSection integrations={telematicsRows} orgId={profile.org_id} />
    </div>
  )
}
