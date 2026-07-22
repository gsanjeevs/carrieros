// lib/generate-number.ts
// Atomic ID generation via company_sequences table.
// Single INSERT ... ON CONFLICT DO UPDATE RETURNING — no race condition.
// No fixed-width padding — IDs grow naturally (L-1, L-42, L-10523).
// Server-side only — call from API routes and server actions.

import { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type Client = SupabaseClient<Database>
type Entity = 'load' | 'customer' | 'driver' | 'vehicle' | 'invoice'

const PREFIX: Record<Entity, string> = {
  load:     'L',
  customer: 'C',
  driver:   'D',
  vehicle:  'T',
  invoice:  'INV',
}

async function nextVal(client: Client, companyId: number, entity: Entity): Promise<string> {
  // Uses the next_entity_val() Postgres function — atomic, no race condition
  const { data, error } = await client.rpc('next_entity_val', {
    carrier_org_bigint: companyId,
    entity_name:        entity,
  })

  if (error || data == null) {
    throw new Error(`Failed to generate ${entity} number: ${error?.message ?? 'null result'}`)
  }

  return `${PREFIX[entity]}-${data}`
}

export const generateLoadNumber     = (c: Client, cid: number) => nextVal(c, cid, 'load')
export const generateCustomerNumber = (c: Client, cid: number) => nextVal(c, cid, 'customer')
export const generateDriverNumber   = (c: Client, cid: number) => nextVal(c, cid, 'driver')
export const generateVehicleNumber  = (c: Client, cid: number) => nextVal(c, cid, 'vehicle')
export const generateInvoiceNumber  = (c: Client, cid: number) => nextVal(c, cid, 'invoice')
