// server/domain/compliance/dvir.ts
// Driver Vehicle Inspection Reports. Pure. The condition is DERIVED from the defects, never
// trusted from the client: an inspection cannot claim 'satisfactory' while listing defects, or
// 'defects_noted' with none.
import { ok, err, validationFailed, type Result } from '../shared/result'

export const DVIR_TYPES = ['pre_trip', 'post_trip'] as const
export const DVIR_AREAS = ['brakes', 'lights', 'tires', 'steering', 'horn', 'mirrors', 'coupling_devices', 'emergency_equipment'] as const
export const DEFECT_SEVERITIES = ['minor', 'major'] as const

export interface DefectInput {
  readonly area: string
  readonly description: string
  readonly severity: string
}

export interface DvirDraft {
  readonly type: string
  readonly condition: 'satisfactory' | 'defects_noted'
  readonly odometer: number | null
  readonly defects: readonly { area: string; description: string; severity: string }[]
}

export function buildDvir(input: { type: string; odometer?: number | null; defects: readonly DefectInput[] }): Result<DvirDraft> {
  if (!(DVIR_TYPES as readonly string[]).includes(input.type)) return err(validationFailed('Unknown inspection type', { type: 'INVALID' }))
  const odometer = input.odometer ?? null
  if (odometer !== null && (!Number.isInteger(odometer) || odometer < 0)) return err(validationFailed('Odometer must be a whole number', { odometer: 'INVALID' }))

  const seen = new Set<string>()
  const defects: { area: string; description: string; severity: string }[] = []
  for (const d of input.defects) {
    if (!(DVIR_AREAS as readonly string[]).includes(d.area)) return err(validationFailed(`Unknown area "${d.area}"`, { area: 'INVALID' }))
    if (seen.has(d.area)) return err(validationFailed(`Area "${d.area}" listed twice`, { area: 'DUPLICATE' }))
    seen.add(d.area)
    if (!(DEFECT_SEVERITIES as readonly string[]).includes(d.severity)) return err(validationFailed('Severity must be minor or major', { severity: 'INVALID' }))
    const description = d.description.trim()
    if (!description) return err(validationFailed('Every defect needs a description', { description: 'REQUIRED' }))
    defects.push({ area: d.area, description: description.slice(0, 1000), severity: d.severity })
  }
  return ok({ type: input.type, condition: defects.length > 0 ? 'defects_noted' : 'satisfactory', odometer, defects })
}

/** Attachment paths are built server-side, and re-checked on finalize (same principle as load documents). */
export type AttachmentKind = 'signature' | 'defect_photo'

export function buildAttachmentPath(orgId: number, inspectionId: number, kind: AttachmentKind, area: string | null, uuid: string, ext: 'png' | 'jpg'): string {
  const stem = kind === 'signature' ? 'signature' : (area as string)
  return `${orgId}/dvir/${inspectionId}/${stem}-${uuid}.${ext}`
}

export function isIssuedAttachmentPath(path: string, orgId: number, inspectionId: number, kind: AttachmentKind, area: string | null): boolean {
  const stem = kind === 'signature' ? 'signature' : area ?? ''
  if (kind === 'defect_photo' && !(DVIR_AREAS as readonly string[]).includes(stem)) return false
  return new RegExp(`^${orgId}/dvir/${inspectionId}/${stem}-[0-9a-f-]{36}\\.(png|jpg)$`).test(path)
}
