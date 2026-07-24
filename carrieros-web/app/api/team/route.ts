// app/api/team/route.ts
// GET — list team members, view-only. Mobile has no invite/role-change/
// remove UI (those need the service-role Admin Auth API, which must never
// ship to a mobile client — see app/api/team/[id]/route.ts's header
// comment); this route exposes the same read team/page.tsx already does
// server-side, just as JSON for carrieros-mobile's apiFetch() to consume.
import { NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError, createAdminClient } from '@/lib/api-auth'
import { createAuthAdminProvider } from '@/lib/auth-admin'
import { getProfileForUser } from '@/lib/queries/profiles'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id)
    return apiError('NOT_ONBOARDED', 'No organization found for this user', 400)
  if (!['owner', 'solo'].includes(profile.role))
    return apiError('FORBIDDEN', 'Only owner/solo can view the team roster', 403)

  const { data: members } = await supabase
    .from('profiles')
    .select('id, role, first_name, last_name, phone, created_at')
    .eq('org_id', profile.org_id)
    .order('created_at')

  const admin = createAdminClient()
  const { data: authList } = await createAuthAdminProvider(admin).listUsers({ page: 1, perPage: 1000 })
  const authById = new Map((authList?.users ?? []).map((u) => [u.id, u]))

  const rows = (members ?? []).map((m) => {
    const au = authById.get(m.id)
    return {
      id: m.id,
      role: m.role,
      first_name: m.first_name,
      last_name: m.last_name,
      email: au?.email ?? null,
      accepted: Boolean(au?.lastSignInAt),
      created_at: m.created_at,
    }
  })

  return NextResponse.json(rows)
}
