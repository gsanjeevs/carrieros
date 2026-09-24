// server/infrastructure/supabase/field-actions-repository.ts
// Adapters for the small field writes, all through the CALLER'S client so RLS applies.
// Every org/actor column is taken from the ActorContext; each write is column-restricted.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { DriverProfilePatch } from '../../domain/driver/self-profile'
import type { DriverMessageRecord, DriverProfileRecord, DriverSelfRepository, FleetRepository, LoadLocationRepository, MessageRepository, ReminderRecord } from '../../ports'

const fail = (what: string, message: string) => err(domainError('PRECONDITION_FAILED', `${what} failed: ${message}`))

export class SupabaseMessageRepository implements MessageRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}
  async markRead(actor: ActorContext, loadId: number, messageIds: readonly number[], readAt: Date): Promise<Result<number>> {
    const { data, error } = await this.supabase
      .from('driver_messages')
      .update({ read_at: readAt.toISOString() })
      .in('id', [...messageIds])
      .eq('load_id', loadId)
      .eq('carrier_org_id', actor.orgId)
      .neq('sender_id', actor.userId) // you never mark your own messages read
      .is('read_at', null)
      .select('id')
    if (error) return fail('mark read', error.message)
    return ok((data ?? []).length)
  }

  async listForLoad(actor: ActorContext, loadId: number): Promise<Result<readonly DriverMessageRecord[]>> {
    const { data, error } = await this.supabase
      .from('driver_messages')
      .select('id, sender_id, body, original_language, sent_at, read_at')
      .eq('load_id', loadId)
      .eq('carrier_org_id', actor.orgId)
      .order('sent_at', { ascending: true })
    if (error) return fail('message list', error.message)
    return ok((data ?? []) as unknown as DriverMessageRecord[])
  }

  async resolveOriginalLanguage(actor: ActorContext): Promise<Result<string>> {
    const [{ data: profile, error: profileError }, { data: carrier, error: carrierError }] = await Promise.all([
      this.supabase.from('profiles').select('preferred_language').eq('id', actor.userId).maybeSingle(),
      this.supabase.from('carrier_details').select('default_language').eq('org_id', actor.orgId).maybeSingle(),
    ])
    if (profileError) return fail('profile language lookup', profileError.message)
    if (carrierError) return fail('carrier language lookup', carrierError.message)
    return ok(profile?.preferred_language ?? carrier?.default_language ?? 'en')
  }

  async send(actor: ActorContext, loadId: number, body: string, originalLanguage: string): Promise<Result<{ id: number; sent_at: string }>> {
    const { data, error } = await this.supabase
      .from('driver_messages')
      .insert({ carrier_org_id: actor.orgId, load_id: loadId, sender_id: actor.userId, body, original_language: originalLanguage })
      .select('id, sent_at')
      .single()
    if (error || !data) return fail('message send', error?.message ?? 'No row returned')
    return ok({ id: Number(data.id), sent_at: data.sent_at })
  }
}

export class SupabaseLoadLocationRepository implements LoadLocationRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}
  async updateLocation(actor: ActorContext, loadId: number, sample: { latitude: number; longitude: number; recordedAt: Date }): Promise<Result<void>> {
    const at = sample.recordedAt.toISOString()
    // Only these three columns are ever written, and only forward in time (out-of-order samples are dropped).
    const { error } = await this.supabase
      .from('loads')
      .update({ last_location_lat: sample.latitude, last_location_lng: sample.longitude, last_location_at: at })
      .eq('id', loadId)
      .eq('carrier_org_id', actor.orgId)
      .or(`last_location_at.is.null,last_location_at.lt.${at}`)
    if (error) return fail('location update', error.message)
    return ok(undefined)
  }
}

export class SupabaseDriverSelfRepository implements DriverSelfRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}
  async updateOwnProfile(actor: ActorContext, patch: DriverProfilePatch): Promise<Result<boolean>> {
    const { data, error } = await this.supabase
      .from('drivers')
      .update({ ...patch, invite_status: 'accepted' })
      .eq('profile_id', actor.userId) // from the session, never from the request
      .eq('carrier_org_id', actor.orgId)
      .select('id')
    if (error) return fail('driver profile update', error.message)
    return ok((data ?? []).length > 0)
  }
  async vehicleInOrg(actor: ActorContext, vehicleId: number): Promise<Result<boolean>> {
    const { data, error } = await this.supabase.from('vehicles').select('id').eq('id', vehicleId).eq('carrier_org_id', actor.orgId).eq('is_active', true).maybeSingle()
    if (error) return fail('vehicle lookup', error.message)
    return ok(!!data)
  }
  async getOwnProfile(actor: ActorContext): Promise<Result<DriverProfileRecord | null>> {
    const { data, error } = await this.supabase
      .from('drivers')
      .select(
        'id, cdl_number, cdl_class, cdl_state, cdl_expiry, med_cert_expiry, endorsements, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, default_vehicle_id'
      )
      .eq('profile_id', actor.userId)
      .eq('carrier_org_id', actor.orgId)
      .maybeSingle()
    if (error) return fail('driver profile lookup', error.message)
    if (!data) return ok(null)
    return ok({ ...data, id: Number(data.id), endorsements: data.endorsements ?? [] } as DriverProfileRecord)
  }
}

export class SupabaseFleetRepository implements FleetRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}
  async findReminder(actor: ActorContext, vehicleId: number, reminderId: number): Promise<Result<ReminderRecord | null>> {
    const { data, error } = await this.supabase
      .from('maintenance_reminders')
      .select('id, trigger_months, trigger_miles')
      .eq('id', reminderId)
      .eq('vehicle_id', vehicleId)
      .eq('carrier_org_id', actor.orgId)
      .maybeSingle()
    if (error) return fail('reminder lookup', error.message)
    return ok(data ? { id: Number(data.id), triggerMonths: data.trigger_months, triggerMiles: data.trigger_miles } : null)
  }
  async logService(actor: ActorContext, i: Parameters<FleetRepository['logService']>[1]): Promise<Result<{ id: number }>> {
    const { data, error } = await this.supabase.rpc('log_vehicle_service', {
      p_vehicle_id: i.vehicleId,
      p_service_type: i.serviceType,
      p_service_date: i.serviceDate,
      p_odometer: i.odometer as number,
      p_cost: i.cost as number,
      p_shop_name: i.shopName as string,
      p_notes: i.notes as string,
      p_reminder_id: i.reminderId as number,
      p_next_due_date: i.nextDueDate as string,
      p_next_due_miles: i.nextDueMiles as number,
    })
    if (error) {
      if (error.code === 'PT404') return err(domainError('NOT_FOUND', 'Vehicle or reminder not found'))
      return fail('log service', error.message)
    }
    return ok({ id: Number(data) })
  }
}
