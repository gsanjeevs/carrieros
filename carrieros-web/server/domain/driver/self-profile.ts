// server/domain/driver/self-profile.ts
// What a driver may change about THEIR OWN driver record. Pure. Deliberately excludes the
// protected fields (CDL/medical expiry, active flag, driver number, org): those are
// changed by the carrier, and driver_self_update_allowed() in the database refuses a
// change to them too -- this makes the boundary explicit in the API instead of implied by
// "the payload happens not to include them".
import { ok, err, validationFailed, type Result } from '../shared/result'

export const CDL_CLASSES = ['A', 'B', 'C'] as const
export const ENDORSEMENT_CODES = ['hazmat', 'tanker', 'doubles', 'airbrakes', 'passenger'] as const

export interface DriverProfileInput {
  readonly cdlNumber?: string | null
  readonly cdlClass?: string | null
  readonly cdlState?: string | null
  readonly endorsements?: readonly string[]
  readonly emergencyName?: string | null
  readonly emergencyPhone?: string | null
  readonly emergencyRelation?: string | null
  readonly defaultVehicleId?: number | null
}

export interface DriverProfilePatch {
  readonly cdl_number: string | null
  readonly cdl_class: string | null
  readonly cdl_state: string | null
  readonly endorsements: string[]
  readonly emergency_contact_name: string | null
  readonly emergency_contact_phone: string | null
  readonly emergency_contact_relation: string | null
  readonly default_vehicle_id: number | null
}

const clean = (v: string | null | undefined, max: number): string | null => {
  const t = v?.trim() ?? ''
  return t.length === 0 ? null : t.slice(0, max)
}

export function buildDriverProfilePatch(input: DriverProfileInput): Result<DriverProfilePatch> {
  if (input.cdlClass != null && !(CDL_CLASSES as readonly string[]).includes(input.cdlClass)) {
    return err(validationFailed('CDL class must be A, B or C', { cdl_class: 'INVALID' }))
  }
  const state = clean(input.cdlState, 2)
  if (state !== null && !/^[A-Za-z]{2}$/.test(state)) return err(validationFailed('CDL state must be a 2-letter code', { cdl_state: 'INVALID' }))
  const endorsements = [...new Set(input.endorsements ?? [])]
  const bad = endorsements.find((e) => !(ENDORSEMENT_CODES as readonly string[]).includes(e))
  if (bad) return err(validationFailed(`Unknown endorsement "${bad}"`, { endorsements: 'INVALID' }))

  return ok({
    cdl_number: clean(input.cdlNumber, 40),
    cdl_class: input.cdlClass ?? null,
    cdl_state: state?.toUpperCase() ?? null,
    endorsements,
    emergency_contact_name: clean(input.emergencyName, 100),
    emergency_contact_phone: clean(input.emergencyPhone, 30),
    emergency_contact_relation: clean(input.emergencyRelation, 50),
    default_vehicle_id: input.defaultVehicleId ?? null,
  })
}
