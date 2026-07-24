// app/(app)/team/page.tsx
// Team management — the carrier org's back-office users (dispatcher, finance,
// owner) plus, read-only, the drivers who share the org. Owner/solo only:
// this is an administration surface, not a dispatcher or finance one.
//
// Email and invite state are NOT on `profiles` — they live in auth.users,
// which is only reachable through the service-role Admin Auth API. Hence the
// admin client here. It is a Server Component, so the service role key never
// crosses to the browser; all *mutations* still go through /api/team/*.
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { createAuthAdminProvider } from '@/lib/auth-admin'
import { formatDate } from '@/lib/format-datetime'
import InviteMemberButton from './InviteMemberButton'
import MemberActions from './MemberActions'
import { Card, StatusBadge, type StatusBadgeVariant, Table, TableHeaderCell, TableRow, TableCell } from '@/components/ui'
import { getProfileForUser, listProfilesForOrg } from '@/lib/queries/profiles'

const ROLE_VARIANT: Record<string, StatusBadgeVariant> = {
  owner:      'brand',
  solo:       'brand',
  dispatcher: 'info',
  finance:    'purple',
  driver:     'neutral',
}

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) redirect('/onboarding')
  if (!['owner', 'solo'].includes(profile.role)) redirect('/dashboard')

  const t = await getTranslations('team')

  const { data: members } = await listProfilesForOrg(supabase, profile.org_id)

  // auth.users lookup: email + whether the magic link has ever been used.
  // Micro-carrier orgs are 1–10 people (decision P1), so one page is ample.
  const admin = createAdminClient()
  const { data: authList } = await createAuthAdminProvider(admin).listUsers({ page: 1, perPage: 1000 })
  const authById = new Map((authList?.users ?? []).map((u) => [u.id, u]))

  const rows = (members ?? []).map((m) => {
    const au = authById.get(m.id)
    return {
      ...m,
      email: au?.email ?? null,
      // "active" = has actually signed in at least once. Supabase sets
      // last_sign_in_at only on a real session, so an unopened invite stays
      // pending even though the auth.users row already exists.
      accepted: Boolean(au?.lastSignInAt),
    }
  })

  const isDriverRole = (role: string) => ['driver', 'solo'].includes(role)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
          <p className="text-text-sec text-sm mt-1">{t('memberCount', { count: rows.length })}</p>
        </div>
        <InviteMemberButton />
      </div>

      <div className="mb-6 flex items-start gap-3 rounded-lg bg-surface-subtle border border-border-ui px-4 py-3">
        <span className="material-symbols-outlined text-text-sec text-[18px]">info</span>
        <p className="text-text-sec text-sm">
          {t('driversHint')}{' '}
          <Link href="/drivers" className="text-brand-orange hover:underline rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
            {t('driversHintLink')}
          </Link>
        </p>
      </div>

      <Card>
        <Table>
          <thead>
            <tr>
              <TableHeaderCell>{t('name')}</TableHeaderCell>
              <TableHeaderCell>{t('email')}</TableHeaderCell>
              <TableHeaderCell>{t('role')}</TableHeaderCell>
              <TableHeaderCell>{t('status')}</TableHeaderCell>
              <TableHeaderCell>{t('joined')}</TableHeaderCell>
              <TableHeaderCell></TableHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const name = [m.first_name, m.last_name].filter(Boolean).join(' ') || '—'
              const isSelf = m.id === user.id
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-medium text-text-pri">
                    {name}
                    {isSelf && <span className="ml-2 text-xs text-text-sec">{t('you')}</span>}
                  </TableCell>
                  <TableCell>{m.email ?? '—'}</TableCell>
                  <TableCell>
                    <StatusBadge variant={ROLE_VARIANT[m.role] ?? ROLE_VARIANT.driver} size="sm">
                      {t(`role_${m.role}` as never)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge variant={m.accepted ? 'success' : 'warning'} size="sm">
                      {m.accepted ? t('statusActive') : t('statusPending')}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    {formatDate(m.created_at, profile)}
                  </TableCell>
                  <TableCell className="text-right">
                    {isSelf ? (
                      // Invariant 1: a user may never change their own role.
                      // Enforced in /api/team/[id]; not offered here either.
                      <span className="text-xs text-text-mut">{t('cannotEditSelf')}</span>
                    ) : isDriverRole(m.role) ? (
                      <Link href="/drivers" className="text-xs text-text-sec hover:text-brand-orange transition rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
                        {t('manageOnDrivers')}
                      </Link>
                    ) : (
                      <MemberActions
                        memberId={m.id}
                        role={m.role}
                        name={name === '—' ? (m.email ?? '') : name}
                      />
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
