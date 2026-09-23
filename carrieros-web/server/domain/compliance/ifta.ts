// server/domain/compliance/ifta.ts
// IFTA state-mileage records. Pure validation. The state code is the field that has to be right:
// quarterly tax is computed per state from these rows.
import { ok, err, validationFailed, type Result } from '../shared/result'

export const IFTA_FEATURE_KEY = 'ifta_mileage_log'

export interface GpsCrossingInput {
  readonly state: string
  readonly crossedAt: Date
  readonly latitude?: number | null
  readonly longitude?: number | null
}

export interface ManualRow {
  readonly state: string
  readonly miles: number
}

export function validateGpsCrossing(input: GpsCrossingInput, now: Date): Result<{ state: string; crossedAt: Date; latitude: number | null; longitude: number | null }> {
  const state = input.state.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(state)) return err(validationFailed('State must be a 2-letter code', { state: 'INVALID' }))
  // A crossing "in the future" is a phone-clock error; clamp instead of storing a timeline that can't happen.
  const crossedAt = input.crossedAt.getTime() > now.getTime() + 5 * 60_000 ? now : input.crossedAt
  const lat = input.latitude ?? null
  const lng = input.longitude ?? null
  if (lat !== null && (lat < -90 || lat > 90)) return err(validationFailed('Latitude out of range', { lat: 'OUT_OF_RANGE' }))
  if (lng !== null && (lng < -180 || lng > 180)) return err(validationFailed('Longitude out of range', { lng: 'OUT_OF_RANGE' }))
  return ok({ state, crossedAt, latitude: lat, longitude: lng })
}

export function validateManualRows(rows: readonly { state: string; miles: number }[]): Result<ManualRow[]> {
  if (rows.length === 0 || rows.length > 60) return err(validationFailed('Provide between 1 and 60 rows', { rows: 'INVALID' }))
  const out: ManualRow[] = []
  for (const r of rows) {
    const state = r.state.trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(state)) return err(validationFailed(`"${r.state}" is not a 2-letter state`, { state: 'INVALID' }))
    if (!Number.isInteger(r.miles) || r.miles <= 0 || r.miles > 5000) return err(validationFailed('Miles must be a whole number between 1 and 5000', { miles: 'OUT_OF_RANGE' }))
    out.push({ state, miles: r.miles })
  }
  return ok(out)
}
