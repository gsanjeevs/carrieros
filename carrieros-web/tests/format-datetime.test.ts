import { describe, it, expect } from 'vitest'
import { formatDate, formatTime, formatDateTime, getEffectiveTimezone } from '@/lib/format-datetime'

describe('format-datetime timezone support', () => {
  it('renders a UTC timestamp correctly in a non-UTC timezone', () => {
    // 2026-08-19T23:30:00Z is 2026-08-19 16:30 in Los Angeles (PDT, UTC-7)
    // and 2026-08-20 04:30 in Karachi (PKT, UTC+5, no DST).
    const value = '2026-08-19T23:30:00Z'

    expect(formatDate(value, { timezone: 'America/Los_Angeles' })).toBe('08/19/2026')
    expect(formatTime(value, { timezone: 'America/Los_Angeles', time_format: '24h' })).toBe('16:30')

    expect(formatDate(value, { timezone: 'Asia/Karachi' })).toBe('08/20/2026')
    expect(formatTime(value, { timezone: 'Asia/Karachi', time_format: '24h' })).toBe('04:30')

    expect(formatDateTime(value, { timezone: 'Asia/Karachi', time_format: '24h' })).toBe('08/20/2026 04:30')
  })

  it('leaves a bare date-only string unaffected by timezone', () => {
    // loads.pickup_date-style value: no time component, must not shift by a day
    // regardless of the requested timezone (that's the exact bug the DATE_ONLY
    // handling in toDate() exists to prevent).
    const value = '2026-08-19'

    expect(formatDate(value, { timezone: 'Pacific/Kiritimati' })).toBe('08/19/2026') // UTC+14
    expect(formatDate(value, { timezone: 'Etc/GMT+12' })).toBe('08/19/2026') // UTC-12
    expect(formatDate(value)).toBe('08/19/2026')
  })

  it('behaves exactly as before when no timezone is provided', () => {
    const value = new Date(2026, 7, 19, 16, 30) // Aug 19 2026, 16:30 local
    expect(formatDate(value)).toBe('08/19/2026')
    expect(formatTime(value)).toBe('4:30 PM')
    expect(formatTime(value, { time_format: '24h' })).toBe('16:30')
    expect(formatDateTime(value, { date_format: 'YYYY-MM-DD', time_format: '24h' })).toBe('2026-08-19 16:30')
  })

  it('returns the placeholder for null/undefined/invalid values regardless of timezone', () => {
    expect(formatDate(null, { timezone: 'America/Los_Angeles' })).toBe('—')
    expect(formatDate(undefined, { timezone: 'America/Los_Angeles' })).toBe('—')
    expect(formatDateTime('not-a-date', { timezone: 'America/Los_Angeles' })).toBe('—')
  })
})

describe('getEffectiveTimezone', () => {
  it('prefers the profile override when set', () => {
    expect(
      getEffectiveTimezone({ timezone: 'America/New_York' }, { timezone: 'America/Los_Angeles' }),
    ).toBe('America/New_York')
  })

  it('falls back to the carrier default when the profile has no override', () => {
    expect(getEffectiveTimezone({ timezone: null }, { timezone: 'America/Chicago' })).toBe('America/Chicago')
    expect(getEffectiveTimezone({}, { timezone: 'America/Chicago' })).toBe('America/Chicago')
  })

  it('falls back to America/Los_Angeles when neither profile nor carrier default is set', () => {
    expect(getEffectiveTimezone({ timezone: null }, { timezone: null })).toBe('America/Los_Angeles')
    expect(getEffectiveTimezone({ timezone: null }, null)).toBe('America/Los_Angeles')
    expect(getEffectiveTimezone({})).toBe('America/Los_Angeles')
  })
})
