// server/domain/load/read-model.ts
// The shape of a load as shown in lists. `rate` is absent (not null) when the
// caller's role may not see money: the field must not exist in the payload at
// all, so a client bug or a curious user with dev tools has nothing to find.

export interface LoadSummary {
  readonly id: number
  readonly load_number: string
  readonly status: string
  readonly customer_name_raw: string | null
  readonly pickup_city: string | null
  readonly pickup_state: string | null
  readonly delivery_city: string | null
  readonly delivery_state: string | null
  readonly pickup_date: string | null
  readonly delivery_date: string | null
  readonly commodity: string | null
  readonly driver_id: number | null
  readonly rate?: number | null
}
