// server/domain/shared/money.ts
// Structured money. Integer minor units plus an explicit currency.
//
// The existing schema stores rates and invoice totals as NUMERIC and the apps
// pass them around as JavaScript numbers. That works until it doesn't: 0.1+0.2
// is not 0.3 in binary floating point, and a fuel surcharge computed as a
// percentage of a linehaul is exactly the kind of arithmetic that accumulates
// error. Freight money also crosses currencies (the schema already supports
// USD/CAD/MXN), and a bare number cannot say which one it is — so a CAD rate
// and a USD rate can be added together with no complaint from the compiler.
//
// Minor units (cents) are used because they are exact under integer arithmetic
// and because that is what payment providers settle in.

import { type Result, ok, err, validationFailed } from './result'

export type CurrencyCode = 'USD' | 'CAD' | 'MXN'
export const SUPPORTED_CURRENCIES: readonly CurrencyCode[] = ['USD', 'CAD', 'MXN']

export interface Money {
  /** Signed integer in the currency's minor unit. 12345 USD = $123.45. */
  readonly amountMinor: number
  readonly currency: CurrencyCode
}

export function money(amountMinor: number, currency: CurrencyCode): Result<Money> {
  if (!Number.isInteger(amountMinor)) {
    return err(
      validationFailed(
        `Money must be an integer number of minor units, received ${amountMinor}. ` +
          `A fractional cent usually means a major-unit value was passed by mistake.`
      )
    )
  }
  if (!Number.isSafeInteger(amountMinor)) {
    return err(validationFailed('Money amount exceeds the safe integer range'))
  }
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    return err(validationFailed(`Unsupported currency ${currency}`))
  }
  return ok({ amountMinor, currency })
}

/** Parse a decimal major-unit string ("1234.56") without going through float. */
export function moneyFromDecimalString(value: string, currency: CurrencyCode): Result<Money> {
  const trimmed = value.trim()
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed)
  if (!m) return err(validationFailed(`"${value}" is not a valid monetary amount`))
  const [, sign, whole, frac = ''] = m
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return money(sign === '-' ? -minor : minor, currency)
}

/**
 * Convert a NUMERIC column value. Kept explicit and fallible rather than
 * silently rounding: a value that will not survive the round trip is a data
 * problem worth surfacing at the boundary, not hiding inside a repository.
 */
export function moneyFromNumeric(value: number | string | null, currency: CurrencyCode): Result<Money> {
  if (value === null) return err(validationFailed('Monetary value is null'))
  if (typeof value === 'string') return moneyFromDecimalString(value, currency)
  const minor = Math.round(value * 100)
  if (Math.abs(minor - value * 100) > 1e-6) {
    return err(validationFailed(`Monetary value ${value} has sub-cent precision and cannot be represented exactly`))
  }
  return money(minor, currency)
}

function assertSameCurrency(a: Money, b: Money): Result<true> {
  if (a.currency !== b.currency) {
    return err(
      validationFailed(
        `Cannot combine ${a.currency} and ${b.currency}. Convert explicitly with a dated FX rate first — ` +
          `there is deliberately no implicit conversion, because the rate and its as-of date are business decisions.`
      )
    )
  }
  return ok(true)
}

export function addMoney(a: Money, b: Money): Result<Money> {
  const same = assertSameCurrency(a, b)
  if (!same.ok) return same
  return money(a.amountMinor + b.amountMinor, a.currency)
}

export function subtractMoney(a: Money, b: Money): Result<Money> {
  const same = assertSameCurrency(a, b)
  if (!same.ok) return same
  return money(a.amountMinor - b.amountMinor, a.currency)
}

/**
 * Multiply by a dimensionless factor (a percentage, a per-mile count).
 * Rounds half away from zero, which is what invoicing conventions expect and
 * what JavaScript's Math.round does NOT do for negatives (Math.round(-0.5) is
 * -0, not -1).
 */
export function multiplyMoney(m: Money, factor: number): Result<Money> {
  if (!Number.isFinite(factor)) return err(validationFailed('Multiplier must be finite'))
  const raw = m.amountMinor * factor
  const rounded = raw < 0 ? -Math.round(-raw) : Math.round(raw)
  return money(rounded, m.currency)
}

export const isZero = (m: Money) => m.amountMinor === 0
export const isNegative = (m: Money) => m.amountMinor < 0

/** Wire representation. Never a float — the string keeps exactness across JSON. */
export interface MoneyDto {
  readonly amount: string
  readonly currency: CurrencyCode
  readonly amountMinor: number
}

export function toMoneyDto(m: Money): MoneyDto {
  const sign = m.amountMinor < 0 ? '-' : ''
  const abs = Math.abs(m.amountMinor)
  return {
    amount: `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`,
    currency: m.currency,
    amountMinor: m.amountMinor,
  }
}
