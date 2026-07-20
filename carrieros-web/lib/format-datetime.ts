// lib/format-datetime.ts
// Renders timestamps using the caller's personal profiles.date_format /
// profiles.time_format preferences (set in app/(app)/settings). The allowed
// date_format values match DATE_FORMAT_EXAMPLES in ProfileSettingsForm.tsx.

export interface DateTimePrefs {
  date_format?: string | null
  time_format?: string | null
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

export function formatDate(value: string | Date | null | undefined, prefs?: DateTimePrefs): string {
  if (!value) return '—'
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return '—'

  const yyyy = String(d.getFullYear())
  const mm = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())

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

  const h24 = d.getHours()
  const min = pad(d.getMinutes())

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
