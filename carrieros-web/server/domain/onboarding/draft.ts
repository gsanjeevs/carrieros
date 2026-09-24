import { ok, type Result } from '../shared/result'

export interface OnboardingDraft {
  readonly companyName: string
  readonly mcNumber: string | null
  readonly dotNumber: string | null
  readonly ein: string | null
  readonly address: string | null
  readonly country: string
  readonly state: string
  readonly city: string | null
  readonly zip: string | null
  readonly netTermsDays: number
  readonly tier: 'starter' | 'growth' | 'pro' | 'enterprise'
  readonly timezone: string
  readonly uomSystem: 'imperial' | 'metric'
  readonly currency: string
  readonly firstName: string
  readonly lastName: string
  readonly role: 'owner' | 'solo'
}

export interface OnboardingDraftInput {
  readonly companyName: string
  readonly mcNumber?: string | null
  readonly dotNumber?: string | null
  readonly ein?: string | null
  readonly address?: string | null
  readonly country?: string | null
  readonly state: string
  readonly city?: string | null
  readonly zip?: string | null
  readonly defaultNetTermsDays?: number
  readonly firstName: string
  readonly lastName: string
  readonly role?: 'owner' | 'solo'
  readonly tier?: 'starter' | 'growth' | 'pro' | 'enterprise'
}

const VALID_NET_TERMS = [7, 15, 30, 45, 60]
const US_TIMEZONES: Record<string, string> = {
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu', WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', CA: 'America/Los_Angeles',
  NV: 'America/Los_Angeles', ID: 'America/Boise', MT: 'America/Denver', WY: 'America/Denver', UT: 'America/Denver', CO: 'America/Denver',
  AZ: 'America/Phoenix', NM: 'America/Denver', ND: 'America/Chicago', SD: 'America/Chicago', NE: 'America/Chicago', KS: 'America/Chicago',
  MN: 'America/Chicago', IA: 'America/Chicago', MO: 'America/Chicago', WI: 'America/Chicago', IL: 'America/Chicago', MI: 'America/Detroit',
  IN: 'America/Indiana/Indianapolis', OH: 'America/New_York', KY: 'America/New_York', TN: 'America/Chicago', OK: 'America/Chicago',
  TX: 'America/Chicago', AR: 'America/Chicago', LA: 'America/Chicago', MS: 'America/Chicago', AL: 'America/Chicago', GA: 'America/New_York',
  FL: 'America/New_York', SC: 'America/New_York', NC: 'America/New_York', VA: 'America/New_York', WV: 'America/New_York',
  MD: 'America/New_York', DE: 'America/New_York', PA: 'America/New_York', NJ: 'America/New_York', NY: 'America/New_York',
  CT: 'America/New_York', RI: 'America/New_York', MA: 'America/New_York', VT: 'America/New_York', NH: 'America/New_York', ME: 'America/New_York',
}
const CA_TIMEZONES: Record<string, string> = {
  BC: 'America/Vancouver', AB: 'America/Edmonton', SK: 'America/Regina', MB: 'America/Winnipeg', ON: 'America/Toronto', QC: 'America/Toronto',
  NB: 'America/Halifax', NS: 'America/Halifax', PE: 'America/Halifax', NL: 'America/St_Johns', YT: 'America/Whitehorse',
  NT: 'America/Yellowknife', NU: 'America/Rankin_Inlet',
}

export function deriveTimezone(country: string, state: string): string {
  if (country === 'CA') return CA_TIMEZONES[state] ?? 'America/Toronto'
  if (country === 'MX') return 'America/Mexico_City'
  return US_TIMEZONES[state] ?? 'America/Chicago'
}

export function buildOnboardingDraft(input: OnboardingDraftInput): Result<OnboardingDraft> {
  const country = input.country ?? 'US'
  return ok({
    companyName: input.companyName,
    mcNumber: input.mcNumber ?? null,
    dotNumber: input.dotNumber ?? null,
    ein: input.ein ?? null,
    address: input.address ?? null,
    country,
    state: input.state,
    city: input.city ?? null,
    zip: input.zip ?? null,
    netTermsDays: VALID_NET_TERMS.includes(Number(input.defaultNetTermsDays)) ? Number(input.defaultNetTermsDays) : 30,
    tier: input.tier ?? 'starter',
    timezone: deriveTimezone(country, input.state),
    uomSystem: country === 'CA' ? 'metric' : 'imperial',
    currency: country === 'CA' ? 'CAD' : country === 'MX' ? 'MXN' : 'USD',
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    role: input.role ?? 'owner',
  })
}
