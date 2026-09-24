import { err, ok, validationFailed, type Result } from '../shared/result'

export const LOAD_STATUSES = [
  'draft',
  'scheduled',
  'dispatched',
  'picked_up',
  'in_transit',
  'delivered',
  'invoiced',
  'paid',
  'cancelled',
  'declined',
] as const

export interface LoadAssignmentInput {
  readonly driverId?: number | null
  readonly vehicleId?: number | null
  readonly status?: string
}

export interface LoadAssignmentPatch {
  readonly driverId?: number | null
  readonly vehicleId?: number | null
  readonly status?: (typeof LOAD_STATUSES)[number]
}

export function buildLoadAssignment(input: LoadAssignmentInput): Result<LoadAssignmentPatch> {
  if (input.driverId === undefined && input.vehicleId === undefined && input.status === undefined) {
    return err(validationFailed('Provide at least one field to update'))
  }
  if (input.status !== undefined && !LOAD_STATUSES.includes(input.status as (typeof LOAD_STATUSES)[number])) {
    return err(validationFailed('Invalid status', { status: 'INVALID' }))
  }
  return ok(input as LoadAssignmentPatch)
}
