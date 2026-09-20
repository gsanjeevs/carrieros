// server/domain/driver-actions/fuel-stop.ts
// Validation and derivation for a logged fuel purchase. Pure. IFTA reporting
// aggregates gallons by state, so the state code and gallons are the fields that
// must be right; cost is derived when the driver gave a price rather than a total.
import { ok, err, validationFailed, type Result } from '../shared/result'

export interface FuelStopInput {
  readonly state: string
  readonly station?: string | null
  readonly gallons: number
  readonly pricePerGallon?: number | null
  /** A receipt total, when the driver has one; otherwise gallons x price. */
  readonly totalCost?: number | null
  readonly odometer?: number | null
  /** YYYY-MM-DD; defaults to today. */
  readonly stopDate?: string | null
}

export interface FuelStopDraft {
  readonly state: string
  readonly station: string | null
  readonly gallons: number
  readonly pricePerGallon: number | null
  readonly totalCost: number
  readonly odometer: number | null
  readonly stopDate: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildFuelStop(input: FuelStopInput): Result<FuelStopDraft> {
  const state = input.state.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(state)) return err(validationFailed('State must be a 2-letter code', { state: 'INVALID' }))

  if (!Number.isFinite(input.gallons) || input.gallons <= 0 || input.gallons > 1000) {
    return err(validationFailed('Gallons must be between 0 and 1000', { gallons: 'OUT_OF_RANGE' }))
  }
  const price = input.pricePerGallon ?? null
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100)) {
    return err(validationFailed('Price per gallon is out of range', { price_per_gallon: 'OUT_OF_RANGE' }))
  }
  const suppliedTotal = input.totalCost ?? null
  if (suppliedTotal !== null && (!Number.isFinite(suppliedTotal) || suppliedTotal < 0)) {
    return err(validationFailed('Total cost is out of range', { total_cost: 'OUT_OF_RANGE' }))
  }
  const odometer = input.odometer ?? null
  if (odometer !== null && (!Number.isInteger(odometer) || odometer < 0)) {
    return err(validationFailed('Odometer must be a whole number', { odometer: 'INVALID' }))
  }
  if (input.stopDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.stopDate)) {
    return err(validationFailed('Date must be YYYY-MM-DD', { stop_date: 'INVALID' }))
  }

  return ok({
    state,
    station: input.station?.trim() || null,
    gallons: input.gallons,
    pricePerGallon: price,
    totalCost: suppliedTotal ?? round2(input.gallons * (price ?? 0)),
    odometer,
    stopDate: input.stopDate ?? null,
  })
}
