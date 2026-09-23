// server/infrastructure/supabase/dvir-query-repository.ts
// Read side for DVIR inspections, through the CALLER'S client (RLS applies),
// org scoped by actor.orgId. carrier_dvir_select is org-wide with no role
// restriction (schema.sql) — narrowing a driver to their own inspections is
// an application decision, made by the caller passing a non-null driverId,
// not a query restriction this adapter invents on its own.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { createStorageProvider } from '@/lib/storage'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { DvirHistoryItem, DvirInspectionBrief, DvirQueryRepository } from '../../ports'

const SIGNATURE_URL_TTL_SECONDS = 3600
const HISTORY_LIMIT = 50

type HistoryRow = {
  id: number
  type: string
  condition: string
  odometer: number | null
  signature_url: string | null
  submitted_at: string
  vehicles: { vehicle_number: string | null; nickname: string } | null
  drivers: { profiles: { first_name: string | null; last_name: string | null } | null } | null
  dvir_defects: { id: number; area: string; description: string | null; severity: string | null }[]
}

export class SupabaseDvirQueryRepository implements DvirQueryRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listForLoad(actor: ActorContext, loadId: number, type?: string): Promise<Result<readonly DvirInspectionBrief[]>> {
    let query = this.supabase
      .from('dvir_inspections')
      .select('id, type, created_at')
      .eq('load_id', loadId)
      .eq('carrier_org_id', actor.orgId)
      .order('created_at', { ascending: false })
    if (type) query = query.eq('type', type)
    const { data, error } = await query
    if (error) return err(domainError('PRECONDITION_FAILED', `dvir list failed: ${error.message}`))
    return ok((data ?? []) as unknown as DvirInspectionBrief[])
  }

  async listForActor(actor: ActorContext, driverId: number | null): Promise<Result<readonly DvirHistoryItem[]>> {
    let query = (this.supabase as unknown as SupabaseClient)
      .from('dvir_inspections')
      .select(
        'id, type, condition, odometer, signature_url, submitted_at, vehicles(vehicle_number, nickname), drivers(profiles(first_name, last_name)), dvir_defects(id, area, description, severity)'
      )
      .eq('carrier_org_id', actor.orgId)
      .order('submitted_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    if (driverId !== null) query = query.eq('driver_id', driverId)

    const { data, error } = await query
    if (error) return err(domainError('PRECONDITION_FAILED', `dvir history failed: ${error.message}`))
    const rows = (data ?? []) as unknown as HistoryRow[]

    const provider = createStorageProvider(this.supabase)
    const items = await Promise.all(
      rows.map(async (r) => {
        let signatureUrl: string | null = null
        if (r.signature_url) {
          try {
            signatureUrl = await provider.getSignedUrl(r.signature_url, SIGNATURE_URL_TTL_SECONDS)
          } catch {
            signatureUrl = null
          }
        }
        const driverName = r.drivers?.profiles
          ? [r.drivers.profiles.first_name, r.drivers.profiles.last_name].filter(Boolean).join(' ') || null
          : null
        return {
          id: Number(r.id),
          type: r.type,
          condition: r.condition,
          odometer: r.odometer,
          submitted_at: r.submitted_at,
          signature_url: signatureUrl,
          vehicle: r.vehicles ? { vehicle_number: r.vehicles.vehicle_number, nickname: r.vehicles.nickname } : null,
          driver_name: driverName,
          defects: r.dvir_defects ?? [],
        } as DvirHistoryItem
      })
    )
    return ok(items)
  }
}
