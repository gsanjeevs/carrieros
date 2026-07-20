// lib/format-datetime.ts
// Renders timestamps using the caller's personal profiles.date_format /
// profiles.time_format preferences (set in app/(app)/settings). The allowed
// date_format values match DATE_FORMAT_EXAMPLES in ProfileSettingsForm.tsx.

export interface DateTimePrefs {
  date_format?: string | null
  time_format?: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatDate(value: string | Date | null | undefined, prefs?: DateTimePrefs): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
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
  const d = value instanceof Date ? value : new Date(value)
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
