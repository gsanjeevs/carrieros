// server/infrastructure/supabase/idempotency-repository.ts
// Implements the reserve -> complete/abandon lifecycle over idempotency_keys.
//
// Runs as service_role (client roles may only SELECT/INSERT that table, migration
// 0005/0013) but EVERY statement is scoped by the verified actor's org and user, so
// the elevated role is never the thing deciding whose key it is.
//
// Reservation = insert with status_code 0 and a short expiry; the UNIQUE
// (org, endpoint, key) constraint arbitrates concurrent requests. complete() stores
// the response and extends expiry to 24h; abandon() deletes an unfinished
// reservation so the client can retry. A crashed request's reservation simply
// expires after RESERVATION_MS instead of blocking the key for a day.
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { IdempotencyBegin, IdempotencyRepository } from '../../ports'

const RESERVATION_MS = 2 * 60 * 1000
const RETENTION_MS = 24 * 60 * 60 * 1000

// Key order must not change the hash, or a client that serialises fields in a
// different order would be told it reused a key.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
const hashOf = (body: unknown) => createHash('sha256').update(canonical(body)).digest('hex')

export class SupabaseIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly admin: SupabaseClient<Database>) {}

  private scope(actor: ActorContext, endpoint: string, key: string) {
    return { org_id: actor.orgId, endpoint, idempotency_key: key }
  }

  async begin(actor: ActorContext, endpoint: string, key: string, requestBody: unknown): Promise<Result<IdempotencyBegin>> {
    const requestHash = hashOf(requestBody)
    const now = Date.now()

    // Clear an expired reservation/response for this key so it can be reused.
    await this.admin
      .from('idempotency_keys')
      .delete()
      .match(this.scope(actor, endpoint, key))
      .lt('expires_at', new Date(now).toISOString())

    const { error } = await this.admin.from('idempotency_keys').insert({
      ...this.scope(actor, endpoint, key),
      user_id: actor.userId,
      request_hash: requestHash,
      status_code: 0,
      response_body: null,
      correlation_id: actor.correlationId,
      expires_at: new Date(now + RESERVATION_MS).toISOString(),
    })
    if (!error) return ok({ kind: 'proceed' })
    if (error.code !== '23505') return err(domainError('PRECONDITION_FAILED', `idempotency reserve failed: ${error.message}`))

    // Someone already holds this key.
    const { data: existing, error: readError } = await this.admin
      .from('idempotency_keys')
      .select('user_id, request_hash, status_code, response_body')
      .match(this.scope(actor, endpoint, key))
      .maybeSingle()
    if (readError || !existing) return err(domainError('PRECONDITION_FAILED', 'idempotency lookup failed'))

    if (existing.user_id !== actor.userId || existing.request_hash !== requestHash) return ok({ kind: 'key_reused' })
    if (existing.status_code === 0) return ok({ kind: 'in_progress' })
    return ok({ kind: 'replay', responseBody: existing.response_body })
  }

  async complete(actor: ActorContext, endpoint: string, key: string, responseBody: unknown): Promise<Result<void>> {
    const { error } = await this.admin
      .from('idempotency_keys')
      .update({
        status_code: 200,
        response_body: responseBody as never,
        expires_at: new Date(Date.now() + RETENTION_MS).toISOString(),
      })
      .match(this.scope(actor, endpoint, key))
      .eq('user_id', actor.userId)
    if (error) return err(domainError('PRECONDITION_FAILED', `idempotency complete failed: ${error.message}`))
    return ok(undefined)
  }

  async abandon(actor: ActorContext, endpoint: string, key: string): Promise<Result<void>> {
    const { error } = await this.admin
      .from('idempotency_keys')
      .delete()
      .match(this.scope(actor, endpoint, key))
      .eq('user_id', actor.userId)
      .eq('status_code', 0)
    if (error) return err(domainError('PRECONDITION_FAILED', `idempotency abandon failed: ${error.message}`))
    return ok(undefined)
  }
}
