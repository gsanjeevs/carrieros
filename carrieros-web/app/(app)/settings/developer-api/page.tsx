// app/(app)/settings/developer-api/page.tsx
// Public developer API (Phase 9) client management — owner/solo only, same
// gate as billing (subscription_management), same rationale: creating and
// revoking credentials that grant org-wide read access to loads/invoices is
// an administration action, not one dispatchers or finance should reach.
//
// A Server Component reading via server/composition in-process, per ADR
// 0003 — the SAME OAuthClientService the write endpoints
// (/api/v1/oauth-clients) use, so listing and creating can never see a
// different picture of "which clients exist."
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { createOAuthClientService } from '@/server/composition'
import { formatDate } from '@/lib/format-datetime'
import { Callout, Card, EmptyState, StatusBadge, Table, TableCell, TableHeaderCell, TableRow } from '@/components/ui'
import CreateClientButton from './CreateClientButton'
import RevokeClientButton from './RevokeClientButton'

export default async function DeveloperApiPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id) redirect('/onboarding')
  if (!roleHasCapability(profile.role, 'subscription_management')) redirect('/dashboard')

  const t = await getTranslations('developerApi')

  const actor = await buildActorContext(supabase, user, crypto.randomUUID())
  // FORBIDDEN here would mean the capability check above and OAuthClientService's own check disagree —
  // treated as "no clients" rather than a crash, since the redirect above already covers the real case.
  const clients = actor.ok ? await createOAuthClientService().list(actor.value) : null
  const rows = clients?.ok ? clients.value : []

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
          <p className="text-text-sec text-sm mt-1">{t('subtitle')}</p>
        </div>
        <CreateClientButton />
      </div>

      <Callout tone="info" className="my-6">
        {t('tierNote')}
      </Callout>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon="key" title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>{t('name')}</TableHeaderCell>
                <TableHeaderCell>{t('clientId')}</TableHeaderCell>
                <TableHeaderCell>{t('created')}</TableHeaderCell>
                <TableHeaderCell>{t('lastUsed')}</TableHeaderCell>
                <TableHeaderCell>{t('status')}</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-text-pri">{c.name}</TableCell>
                  <TableCell className="font-mono text-xs text-text-sec">{c.clientId}</TableCell>
                  <TableCell>{formatDate(c.createdAt, profile)}</TableCell>
                  <TableCell>{c.lastUsedAt ? formatDate(c.lastUsedAt, profile) : t('neverUsed')}</TableCell>
                  <TableCell>
                    <StatusBadge variant={c.revokedAt ? 'neutral' : 'success'} size="sm">
                      {c.revokedAt ? t('statusRevoked') : t('statusActive')}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-right">
                    {!c.revokedAt && <RevokeClientButton clientId={c.clientId} name={c.name} />}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
