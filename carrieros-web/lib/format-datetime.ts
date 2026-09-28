// lib/format-datetime.ts
// Renders timestamps using the caller's personal profiles.date_format /
// profiles.time_format preferences (set in app/(app)/settings). The allowed
// date_format values match DATE_FORMAT_EXAMPLES in ProfileSettingsForm.tsx.
//
// Timezone (2026-09-27): profiles.timezone (nullable per-user override) and
// carrier_details.timezone (org default) already existed in the schema but
// were never actually applied here — formatDate/formatTime/formatDateTime
// used the JS Date object's local getters (d.getHours(), d.getMonth(), ...),
// which read the *server's* timezone on a server-rendered page, not the
// user's. This file now accepts an optional `timezone` IANA zone name and
// renders through Intl.DateTimeFormat when one is provided. Passing no
// timezone (every existing call site, today) preserves the exact previous
// local-getter behavior — this is an additive, backward-compatible change,
// not a rewrite of existing behavior.

export interface DateTimePrefs {
  date_format?: string | null
  time_format?: string | null
  /** IANA zone name, e.g. 'America/Los_Angeles'. Omitted/null = previous
   *  local-getter behavior (server/runtime local time). */
  timezone?: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')

// Postgres DATE columns (invoices.due_date, loads.pickup_date, …) arrive as a
// bare 'YYYY-MM-DD'. `new Date('2026-08-19')` parses that as UTC midnight,
// which is the previous calendar day in every timezone west of UTC — a due
// date would render one day early. Parse date-only values as local dates.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// Exported so callers that build their own display format (e.g. via
// `.toLocaleDateString(locale, {...})` for a "Jul 21, 2026" style rather than
// this file's fixed MM/DD/YYYY-style output) can still get the same
// date-only-parses-as-local fix without changing their display format.
export function toDate(value: string | Date): Date {
  if (value instanceof Date) return value
  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(value)
}

// A bare date-only value has no time component to convert through a
// timezone — doing so would reintroduce the exact off-by-one-day bug the
// DATE_ONLY comment above describes (e.g. a pickup_date of '2026-08-19'
// must render as 08/19/2026 regardless of the viewer's timezone). Only
// actual timestamps (TIMESTAMPTZ values, ISO strings with a time component,
// or a Date instance) go through Intl.DateTimeFormat's timezone conversion.
function isDateOnly(value: string | Date): boolean {
  return typeof value === 'string' && DATE_ONLY.test(value)
}

interface ZonedParts {
  year: number
  month: number // 1-12
  day: number
  hour: number // 0-23
  minute: number
}

// Extracts the wall-clock date/time in `timeZone` for a given instant, via
// Intl.DateTimeFormat (no extra dependency, correctly handles DST). Uses
// 'en-US' + hourCycle 'h23' purely so the numeric parts are unambiguous to
// parse back out — this never affects the caller-visible output, which is
// always built by this file's own formatting switches below.
function getZonedParts(d: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  }
}

// Resolves the effective parts to render: either the zone-converted wall
// clock (timezone provided + value carries a time component), or the exact
// previous local-getter behavior otherwise.
function resolveParts(value: string | Date, timezone?: string | null): ZonedParts {
  const d = toDate(value)
  if (timezone && !isDateOnly(value)) {
    try {
      return getZonedParts(d, timezone)
    } catch {
      // Invalid/unknown IANA zone name — fall back rather than throwing on render.
    }
  }
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
  }
}

/** profile override, else carrier default, else the DB column default. Mirrors the
 *  uom_system / preferred_language two-level inheritance convention used elsewhere
 *  (see server/infrastructure/supabase/profile-write-repository.ts's org_default_uom_system
 *  fallback: profile column nullable, NULL means inherit the org's carrier_details value). */
export function getEffectiveTimezone(
  profile: { timezone?: string | null },
  carrierDetails?: { timezone?: string | null } | null,
): string {
  return profile.timezone || carrierDetails?.timezone || 'America/Los_Angeles'
}

export function formatDate(value: string | Date | null | undefined, prefs?: DateTimePrefs): string {
  if (!value) return '—'
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return '—'

  const { year, month, day } = resolveParts(value, prefs?.timezone)
  const yyyy = String(year)
  const mm = pad(month)
  const dd = pad(day)

  switch (prefs?.date_format) {
    case 'DD/MM/YYYY': return `${dd}/${mm}/${yyyy}`
    case 'YYYY-MM-DD': return `${yyyy}-${mm}-${dd}`
    default:           return `${mm}/${dd}/${yyyy}`
  }
}

export function formatTime(value: string | Date | null | undefined, prefs?: DateTimePrefs): string {
  if (!value) return '—'
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return '—'

  const { hour: h24, minute } = resolveParts(value, prefs?.timezone)
  const min = pad(minute)

  if (prefs?.time_format === '24h') return `${pad(h24)}:${min}`

  const suffix = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${min} ${suffix}`
}

export function formatDateTime(value: string | Date | null | undefined, prefs?: DateTimePrefs): string {
  if (!value) return '—'
  const date = formatDate(value, prefs)
  if (date === '—') return '—'
  return `${date} ${formatTime(value, prefs)}`
}
