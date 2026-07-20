// app/api/onboarding/route.ts
// Creates organizations + carrier_details + profiles atomically for a new carrier user.
// Uses admin client (service role) for DB writes to bypass RLS during initial setup.
import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'

// Derive timezone from country + state
function deriveTimezone(country: string, state: string): string {
  if (country === 'CA') {
    const map: Record<string, string> = {
      BC: 'America/Vancouver', AB: 'America/Edmonton', SK: 'America/Regina',
      MB: 'America/Winnipeg', ON: 'America/Toronto', QC: 'America/Toronto',
      NB: 'America/Halifax', NS: 'America/Halifax', PE: 'America/Halifax',
      NL: 'America/St_Johns', YT: 'America/Whitehorse', NT: 'America/Yellowknife',
      NU: 'America/Rankin_Inlet',
    }
    return map[state] ?? 'America/Toronto'
  }
  if (country === 'MX') return 'America/Mexico_City'
  // US states
  const map: Record<string, string> = {
    AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
    WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', CA: 'America/Los_Angeles',
    NV: 'America/Los_Angeles', ID: 'America/Boise', MT: 'America/Denver',
    WY: 'America/Denver', UT: 'America/Denver', CO: 'America/Denver',
    AZ: 'America/Phoenix', NM: 'America/Denver',
    ND: 'America/Chicago', SD: 'America/Chicago', NE: 'America/Chicago',
    KS: 'America/Chicago', MN: 'America/Chicago', IA: 'America/Chicago',
    MO: 'America/Chicago', WI: 'America/Chicago', IL: 'America/Chicago',
    MI: 'America/Detroit', IN: 'America/Indiana/Indianapolis',
    OH: 'America/New_York', KY: 'America/New_York', TN: 'America/Chicago',
    OK: 'America/Chicago', TX: 'America/Chicago', AR: 'America/Chicago',
    LA: 'America/Chicago', MS: 'America/Chicago', AL: 'America/Chicago',
    GA: 'America/New_York', FL: 'America/New_York', SC: 'America/New_York',
    NC: 'America/New_York', VA: 'America/New_York', WV: 'America/New_York',
    MD: 'America/New_York', DE: 'America/New_York', PA: 'America/New_York',
    NJ: 'America/New_York', NY: 'America/New_York', CT: 'America/New_York',
    RI: 'America/New_York', MA: 'America/New_York', VT: 'America/New_York',
    NH: 'America/New_York', ME: 'America/New_York',
  }
  return map[state] ?? 'America/Chicago'
}

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  // Prevent double-onboarding
  const { data: existing } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .maybeSingle()

  if (existing?.org_id)
    return apiError('ALREADY_ONBOARDED', 'Already onboarded', 409)

  const body = await request.json()
  const { company_name, mc_number, dot_number, country, state, city, first_name, last_name, role } = body

  if (!company_name || !state || !first_name || !last_name)
    return apiError('VALIDATION_ERROR', 'Missing required fields', 400)

  const timezone  = deriveTimezone(country ?? 'US', state)
  const uom       = country === 'CA' ? 'metric' : 'imperial'
  const currency  = country === 'CA' ? 'CAD' : country === 'MX' ? 'MXN' : 'USD'

  // Use admin client for all DB writes — bypasses RLS during initial setup
  const admin = createAdminClient()

  // 1. Create organization
  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .insert({ type: 'carrier', name: company_name, city: city ?? null, state, country: country ?? 'US', currency })
    .select('id')
    .single()

  if (orgErr) { console.error('[onboarding] step1 org:', orgErr); return NextResponse.json({ error_code: 'SERVER_ERROR', error: `[step1] ${orgErr.message}`, code: orgErr.code }, { status: 500 }) }
  const orgId = Number(org.id)
  console.log('[onboarding] org created:', orgId)

  // 2. Create carrier_details
  const { error: detailErr } = await admin
    .from('carrier_details')
    .insert({
      org_id:     orgId,
      mc_number:  mc_number  || null,
      dot_number: dot_number || null,
      tier:       'starter',
      timezone,
      uom_system: uom,
    })

  if (detailErr) { console.error('[onboarding] step2 carrier_details:', detailErr); return NextResponse.json({ error_code: 'SERVER_ERROR', error: `[step2] ${detailErr.message}`, code: detailErr.code }, { status: 500 }) }
  console.log('[onboarding] carrier_details created')

  // 3. Upsert profile
  const { error: profileErr } = await admin
    .from('profiles')
    .upsert({
      id:         user.id,
      org_id:     orgId,
      role:       role ?? 'owner',
      first_name: first_name.trim(),
      last_name:  last_name.trim(),
    }, { onConflict: 'id' })

  if (profileErr) { console.error('[onboarding] step3 profile:', profileErr); return NextResponse.json({ error_code: 'SERVER_ERROR', error: `[step3] ${profileErr.message}`, code: profileErr.code }, { status: 500 }) }
  console.log('[onboarding] profile upserted for', user.id)

  return NextResponse.json({ org_id: orgId }, { status: 201 })
}
