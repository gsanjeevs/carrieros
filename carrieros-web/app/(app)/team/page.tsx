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
import { formatDate } from '@/lib/format-datetime'
import InviteMemberButton from './InviteMemberButton'
import MemberActions from './MemberActions'

const ROLE_COLOR: Record<string, string> = {
  owner:      'bg-[#f97316]/20 text-[#f97316]',
  solo:       'bg-[#f97316]/20 text-[#f97316]',
  dispatcher: 'bg-sky-500/20 text-sky-400',
  finance:    'bg-violet-500/20 text-violet-400',
  driver:     'bg-slate-500/20 text-slate-400',
}

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role, date_format, time_format')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) redirect('/onboarding')
  if (!['owner', 'solo'].includes(profile.role)) redirect('/dashboard')

  const t = await getTranslations('team')

  const { data: members } = await supabase
    .from('profiles')
    .select('id, role, first_name, last_name, phone, created_at')
    .eq('org_id', profile.org_id)
    .order('created_at')

  // auth.users lookup: email + whether the magic link has ever been used.
  // Micro-carrier orgs are 1–10 people (decision P1), so one page is ample.
  const admin = createAdminClient()
  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const authById = new Map((authList?.users ?? []).map((u) => [u.id, u]))

  const rows = (members ?? []).map((m) => {
    const au = authById.get(m.id)
    return {
      ...m,
      email: au?.email ?? null,
      // "active" = has actually signed in at least once. Supabase sets
      // last_sign_in_at only on a real session, so an unopened invite stays
      // pending even though the auth.users row already exists.
      accepted: Boolean(au?.last_sign_in_at),
    }
  })

  const isDriverRole = (role: string) => ['driver', 'solo'].includes(role)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('memberCount', { count: rows.length })}</p>
        </div>
        <InviteMemberButton />
      </div>

      <div className="mb-6 flex items-start gap-3 rounded-lg bg-white/5 border border-white/8 px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
        <span className="material-symbols-outlined text-slate-500 text-[18px]">info</span>
        <p className="text-slate-400 text-sm">
          {t('driversHint')}{' '}
          <Link href="/drivers" className="text-[#f97316] hover:underline rounded focus:outline-none focus:ring-2 focus:ring-[#f97316]/50">
            {t('driversHintLink')}
          </Link>
        </p>
      </div>

      <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('name')}</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('email')}</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('role')}</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('status')}</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('joined')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((m) => {
              const name = [m.first_name, m.last_name].filter(Boolean).join(' ') || '—'
              const isSelf = m.id === user.id
              return (
                <tr key={m.id} className="hover:bg-white/[0.07] transition-colors duration-150">
                  <td className="px-5 py-3.5 text-white font-medium">
                    {name}
                    {isSelf && <span className="ml-2 text-xs text-slate-500">{t('you')}</span>}
                  </td>
                  <td className="px-4 py-3.5 text-slate-400">{m.email ?? '—'}</td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLOR[m.role] ?? ROLE_COLOR.driver}`}>
                      {t(`role_${m.role}` as never)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      m.accepted ? 'bg-[#16a34a]/20 text-[#16a34a]' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {m.accepted ? t('statusActive') : t('statusPending')}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-400">
                    {formatDate(m.created_at, profile)}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {isSelf ? (
                      // Invariant 1: a user may never change their own role.
                      // Enforced in /api/team/[id]; not offered here either.
                      <span className="text-xs text-slate-600">{t('cannotEditSelf')}</span>
                    ) : isDriverRole(m.role) ? (
                      <Link href="/drivers" className="text-xs text-slate-500 hover:text-[#f97316] transition rounded focus:outline-none focus:ring-2 focus:ring-[#f97316]/50">
                        {t('manageOnDrivers')}
                      </Link>
                    ) : (
                      <MemberActions
                        memberId={m.id}
                        role={m.role}
                        name={name === '—' ? (m.email ?? '') : name}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
