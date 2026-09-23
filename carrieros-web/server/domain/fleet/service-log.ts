// server/domain/fleet/service-log.ts
// A logged vehicle service and the maintenance reminder it satisfies. Pure.
import { ok, err, validationFailed, type Result } from '../shared/result'

export interface ServiceLogInput {
  readonly serviceType: string
  readonly serviceDate: string
  readonly odometer?: number | null
  readonly cost?: number | null
  readonly shopName?: string | null
  readonly notes?: string | null
}

export interface ServiceLogDraft {
  readonly serviceType: string
  readonly serviceDate: string
  readonly odometer: number | null
  readonly cost: number | null
  readonly shopName: string | null
  readonly notes: string | null
}

export function buildServiceLog(input: ServiceLogInput): Result<ServiceLogDraft> {
  const serviceType = input.serviceType.trim()
  if (!serviceType || serviceType.length > 100) return err(validationFailed('Service type is required', { service_type: 'REQUIRED' }))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate) || Number.isNaN(Date.parse(input.serviceDate))) {
    return err(validationFailed('Service date must be YYYY-MM-DD', { service_date: 'INVALID' }))
  }
  const odometer = input.odometer ?? null
  if (odometer !== null && (!Number.isInteger(odometer) || odometer < 0)) return err(validationFailed('Odometer must be a whole number', { odometer: 'INVALID' }))
  const cost = input.cost ?? null
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return err(validationFailed('Cost cannot be negative', { cost: 'INVALID' }))
  return ok({
    serviceType,
    serviceDate: input.serviceDate,
    odometer,
    cost,
    shopName: input.shopName?.trim() || null,
    notes: input.notes?.trim() || null,
  })
}

/**
 * Add whole months to a YYYY-MM-DD date, CLAMPING to the last day of the target month
 * (Jan 31 + 1 month = Feb 28/29, not Mar 3 as Date#setMonth's overflow would give). The mobile
 * version this replaces had that overflow bug; computing due dates is exactly where it matters.
 */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const index = (m - 1) + months
  const year = y + Math.floor(index / 12)
  const month = ((index % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export interface ReminderTriggers {
  readonly triggerMonths: number | null
  readonly triggerMiles: number | null
}

export function nextDue(serviceDate: string, odometer: number | null, reminder: ReminderTriggers) {
  return {
    nextDueDate: reminder.triggerMonths ? addMonths(serviceDate, reminder.triggerMonths) : null,
    nextDueMiles: reminder.triggerMiles && odometer ? odometer + reminder.triggerMiles : null,
  }
}
