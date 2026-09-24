// server/domain/customer/write.ts
// Pure shaping for customer edits. "At least one field" is already enforced
// by UpdateCustomerBodySchema's own .refine() at the transport edge; this
// only derives the contactNameProvided/notesProvided flags the repository
// needs to tell "omitted" apart from "explicitly cleared to null" for those
// two nullable columns.
import { ok, type Result } from '../shared/result'

export interface UpdateCustomerRawInput {
  readonly name?: string
  readonly phone?: string | null
  readonly email?: string | null
  readonly address?: string | null
  readonly city?: string | null
  readonly state?: string | null
  readonly zip?: string | null
  readonly country?: string | null
  readonly contact_name?: string | null
  readonly notes?: string | null
}

export interface CustomerUpdatePatch {
  readonly name?: string
  readonly phone?: string | null
  readonly email?: string | null
  readonly address?: string | null
  readonly city?: string | null
  readonly state?: string | null
  readonly zip?: string | null
  readonly country?: string | null
  readonly contactName?: string | null
  readonly notes?: string | null
  readonly contactNameProvided: boolean
  readonly notesProvided: boolean
}

export function buildCustomerUpdate(input: UpdateCustomerRawInput): Result<CustomerUpdatePatch> {
  return ok({
    name: input.name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    city: input.city,
    state: input.state,
    zip: input.zip,
    country: input.country,
    contactName: input.contact_name,
    notes: input.notes,
    contactNameProvided: 'contact_name' in input,
    notesProvided: 'notes' in input,
  })
}
