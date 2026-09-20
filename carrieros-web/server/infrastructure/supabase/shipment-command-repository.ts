// server/infrastructure/supabase/shipment-command-repository.ts
// Adapter for ShipmentCommandRepository. The write goes through the
// submit_shipment_milestone SQL function (migrations 0006-0011) because PostgREST
// cannot span statements in one transaction; that function is infrastructure, not
// business logic (the rules are in the application service).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { getDriverIdForProfile } from '@/lib/queries/drivers'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { MilestoneCommand, MilestoneOutcome, ShipmentAccess, ShipmentCommandRepository } from '../../ports'

export class SupabaseShipmentCommandRepository implements ShipmentCommandRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async findForActor(actor: ActorContext, loadId: number): Promise<Result<ShipmentAccess | null>> {
    const { data, error } = await this.supabase
      .from('loads')
      .select('id, status, driver_id')
      .eq('id', loadId)
      .eq('carrier_org_id', actor.orgId)
      .maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `shipment lookup failed: ${error.message}`))
    if (!data) return ok(null)
    return ok({ id: Number(data.id), status: data.status ?? '', driverId: data.driver_id === null ? null : Number(data.driver_id) })
  }

  async findDriverIdForActor(actor: ActorContext): Promise<Result<number | null>> {
    const { data } = await getDriverIdForProfile(this.supabase, actor.userId)
    return ok(data ? Number(data.id) : null)
  }

  async submitMilestone(actor: ActorContext, command: MilestoneCommand): Promise<Result<MilestoneOutcome>> {
    const { data, error } = await this.supabase.rpc('submit_shipment_milestone', {
      p_load_id: command.loadId,
      p_expected_status: command.expectedStatus,
      p_new_status: command.newStatus,
      p_event_type: command.eventType,
      p_reason: command.reason as string,
      p_correlation_id: actor.correlationId,
      p_idempotency_key: command.idempotencyKey,
      p_occurred_at: command.occurredAt.toISOString(),
    })

    if (error) {
      // SQLSTATEs chosen in migration 0011: PT409 -> conflict, PT404 -> not found.
      if (error.code === 'PT409') {
        const current = error.message.split(':')[1] ?? ''
        return err(domainError('VERSION_CONFLICT', `Shipment is now ${current}`, { meta: { current_status: current } }))
      }
      if (error.code === 'PT404') return err(domainError('NOT_FOUND', 'Shipment not found'))
      if (error.code === '28000') return err(domainError('FORBIDDEN', 'Authentication required'))
      return err(domainError('PRECONDITION_FAILED', `milestone command failed: ${error.message}`))
    }

    const row = data as unknown as { outcome: 'APPLIED' | 'REPLAYED'; load_id: number; status: string; load_number: string | null }
    return ok({ outcome: row.outcome, loadId: Number(row.load_id), status: row.status, loadNumber: row.load_number })
  }
}
