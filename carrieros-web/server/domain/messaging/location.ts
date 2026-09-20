// server/domain/messaging/location.ts
// A live-location sample from the driver's phone. Pure validation only.
import { ok, err, validationFailed, type Result } from '../shared/result'

export const ACTIVE_LOAD_STATUSES = ['dispatched', 'picked_up', 'in_transit'] as const

export function validateLocation(latitude: number, longitude: number): Result<{ latitude: number; longitude: number }> {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return err(validationFailed('Latitude out of range', { latitude: 'OUT_OF_RANGE' }))
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return err(validationFailed('Longitude out of range', { longitude: 'OUT_OF_RANGE' }))
  return ok({ latitude, longitude })
}
