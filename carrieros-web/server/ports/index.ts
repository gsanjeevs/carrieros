// server/ports/index.ts
// Interfaces the application layer depends on. Implementations live in
// server/infrastructure and are injected explicitly — nothing under
// server/domain or server/application ever imports a Supabase client.
//
// These are defined here, outside the adapters, deliberately. If the interface
// lived next to its Supabase implementation it would inevitably grow
// Supabase-shaped methods (`.select('*, drivers(*)')`), and the "port" would
// become a thin rename of the SDK. Defining them from the caller's side keeps
// them expressed in domain terms.

import type { ActorContext, OrgId, UserId, CorrelationId } from '../domain/shared/identity'
import type { EntitlementSnapshot } from '../domain/entitlement/model'
import type { Result } from '../domain/shared/result'
import type { LoadSummary } from '../domain/load/read-model'
import type { ChangeEntity } from '../domain/events/entities'
import type { PreferencesPatch } from '../domain/profile/preferences'

// ── Cross-cutting ───────────────────────────────────────────────────────────

/**
 * Time as a dependency. Domain rules compare against `now` constantly
 * (trial expiry, grace periods, stale tracking), and a rule that reads the
 * system clock itself cannot be tested without either sleeping or freezing
 * global time.
 */
export interface Clock {
  now(): Date
}

/**
 * Id generation as a dependency, for the same reason: an aggregate that mints
 * its own UUID produces a different value on every test run, so assertions
 * have to be written loosely enough to miss real bugs.
 */
export interface IdGenerator {
  uuid(): string
}

/** Structured, correlated logging. Deliberately narrow. */
export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, error: unknown, fields?: Record<string, unknown>): void
}

// ── Unit of work ────────────────────────────────────────────────────────────

/**
 * A transactional scope. The critical guarantee: an aggregate write and its
 * outbox record commit together or not at all. Without that, a crash between
 * the two either loses the event (silently, forever) or emits an event for a
 * change that rolled back.
 *
 * NOTE ON THE CURRENT ADAPTER. PostgREST cannot span multiple statements in one
 * transaction, so the Supabase adapter implements this over a SQL function
 * (`app_execute_command`) that performs the write and the outbox insert in a
 * single round trip. That is why this interface exposes `runInTransaction`
 * rather than letting services issue independent repository calls and hope.
 */
export interface UnitOfWork {
  runInTransaction<T>(work: (tx: TransactionScope) => Promise<Result<T>>): Promise<Result<T>>
}

/** Handle passed to work inside a transaction. Repositories are obtained from it. */
export interface TransactionScope {
  readonly repositories: Repositories
  readonly outbox: OutboxWriter
}

// ── Outbox ──────────────────────────────────────────────────────────────────

/**
 * Business facts worth publishing. Named in past tense: they record something
 * that HAS happened, not a request for something to happen.
 */
export type OutboxEventType =
  | 'RelationshipActivated'
  | 'PricingProposalSubmitted'
  | 'TenderResponseSubmitted'
  | 'BookingConfirmed'
  | 'MilestoneSubmitted'
  | 'DocumentAccepted'
  | 'CarrierInvoiceSubmitted'
  | 'InvoiceDisputed'
  | 'EntitlementChanged'

export interface OutboxEvent {
  readonly eventType: OutboxEventType
  /** Aggregate this fact is about — used for ordering and idempotency. */
  readonly aggregateType: string
  readonly aggregateId: string
  readonly orgId: OrgId
  readonly correlationId: CorrelationId
  readonly payload: Readonly<Record<string, unknown>>
  /**
   * Stable key for de-duplication. Two attempts at the same business action
   * must produce the same key so a replay cannot create a second effect.
   */
  readonly idempotencyKey: string
}

export interface OutboxWriter {
  /** Enqueue within the caller's transaction. Never publishes directly. */
  enqueue(event: OutboxEvent): Promise<void>
}

// ── Repositories ────────────────────────────────────────────────────────────

/**
 * Every repository method takes an ActorContext, and every implementation
 * scopes its query by `actor.orgId` server-side.
 *
 * This is the second line of tenant defence, independent of RLS: if a policy is
 * ever mis-edited, the repository still refuses to read another tenant's row —
 * and if the repository has a bug, RLS still refuses. The rule the adapters
 * follow is that an org id used in a WHERE clause comes from the ActorContext,
 * never from a method argument.
 */
export interface Repositories {
  readonly entitlements: EntitlementRepository
  readonly idempotency: IdempotencyRepository
  readonly audit: AuditRepository
}

export interface EntitlementRepository {
  /** Everything the entitlement decision needs, in one read. */
  loadSnapshot(actor: ActorContext): Promise<Result<EntitlementSnapshot>>
}

/**
 * Idempotency-Key lifecycle for retriable commands: reserve -> complete, or
 * reserve -> abandon when the work fails (so the client may retry).
 *
 * The RESERVATION is what makes it safe under concurrency: the key is inserted
 * first and the UNIQUE constraint arbitrates, so two simultaneous requests with
 * one key cannot both run. The same key replayed with the SAME body returns the
 * stored response; with a DIFFERENT body it is an error, not a silent overwrite.
 */
export type IdempotencyBegin =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'replay'; readonly responseBody: unknown }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'key_reused' }

export interface IdempotencyRepository {
  begin(actor: ActorContext, endpoint: string, key: string, requestBody: unknown): Promise<Result<IdempotencyBegin>>
  complete(actor: ActorContext, endpoint: string, key: string, responseBody: unknown): Promise<Result<void>>
  abandon(actor: ActorContext, endpoint: string, key: string): Promise<Result<void>>
}

/** Append-only audit trail. */
export interface AuditEntry {
  readonly actorUserId: UserId
  readonly orgId: OrgId
  readonly action: string
  readonly aggregateType: string
  readonly aggregateId: string
  readonly priorState: string | null
  readonly newState: string | null
  readonly reason: string | null
  readonly correlationId: CorrelationId
  readonly occurredAt: Date
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface AuditRepository {
  append(entry: AuditEntry): Promise<Result<void>>
}

// ── Read models ─────────────────────────────────────────────────────────────

export interface ListLoadsCriteria {
  /** Empty/undefined = every status. */
  readonly statuses?: readonly string[]
  readonly limit: number
  /** Policy decision made by the application layer; the adapter only obeys it. */
  readonly includeRate: boolean
}

/**
 * Read side for load lists. Scoping by `actor.orgId` (and, for drivers, to
 * their own loads) is the adapter's job and never depends on a caller-supplied
 * id. Adapters must never return `rate` when `includeRate` is false.
 */
export interface LoadReadRepository {
  listForActor(actor: ActorContext, criteria: ListLoadsCriteria): Promise<Result<readonly LoadSummary[]>>
}

// ── Change feed ─────────────────────────────────────────────────────────────

export interface ChangeSignal {
  readonly id: number
  readonly entity: ChangeEntity
}

/**
 * Cursor-based read of the signal-only change feed. `orgId` always comes from
 * an ActorContext; a signal carries no business data, only "entity X changed".
 */
export interface ChangeFeedRepository {
  /** Highest signal id for the org, or 0 when there are none. */
  latestId(orgId: number): Promise<Result<number>>
  readAfter(orgId: number, afterId: number, limit: number): Promise<Result<readonly ChangeSignal[]>>
  /** Housekeeping: the feed is short-lived by design. */
  pruneOlderThan(cutoff: Date): Promise<Result<void>>
}

// ── Shipment commands ───────────────────────────────────────────────────────

export interface ShipmentAccess {
  readonly id: number
  readonly status: string
  readonly driverId: number | null
  readonly vehicleId: number | null
}

export interface MilestoneCommand {
  readonly loadId: number
  readonly expectedStatus: string
  readonly newStatus: string
  readonly eventType: string
  readonly reason: string | null
  readonly idempotencyKey: string
  readonly occurredAt: Date
}

export interface MilestoneOutcome {
  readonly outcome: 'APPLIED' | 'REPLAYED'
  readonly loadId: number
  readonly status: string
  readonly loadNumber: string | null
}

/** Lookups shared by every command that acts on one load. */
export interface ShipmentAccessRepository {
  /** The shipment, only if it belongs to the actor's organization. */
  findForActor(actor: ActorContext, loadId: number): Promise<Result<ShipmentAccess | null>>
  /** The drivers row for a driver actor, or null. */
  findDriverIdForActor(actor: ActorContext): Promise<Result<number | null>>
}

export interface ShipmentCommandRepository extends ShipmentAccessRepository {
  /**
   * Persist status + timeline event + outbox + audit atomically with a
   * compare-and-swap on `expectedStatus`. Idempotent on `idempotencyKey`.
   */
  submitMilestone(actor: ActorContext, command: MilestoneCommand): Promise<Result<MilestoneOutcome>>
}

// ── Profile ─────────────────────────────────────────────────────────────────

/** Writes to the ACTOR'S OWN profile only: the row is chosen from actor.userId, never from a caller-supplied id. */
export interface ProfileWriteRepository {
  updatePreferences(actor: ActorContext, patch: PreferencesPatch): Promise<Result<void>>
  setPushToken(actor: ActorContext, token: string): Promise<Result<void>>
}

// ── Driver actions ──────────────────────────────────────────────────────────

export interface FuelStopRecord {
  readonly state: string
  readonly station: string | null
  readonly stopDate: string
  readonly gallons: number
  readonly pricePerGallon: number | null
  readonly totalCost: number
  readonly odometer: number | null
  /** Resolved by the application layer; the adapter writes it verbatim. */
  readonly driverId: number | null
}

export interface ProblemReportRecord {
  readonly eventType: 'driver_reported_problem'
  readonly severity: 'urgent'
  readonly title: string
  readonly detail: string | null
}

export interface DriverActionRepository {
  createFuelStop(actor: ActorContext, load: ShipmentAccess, record: FuelStopRecord): Promise<Result<{ id: number }>>
  createProblemReport(actor: ActorContext, load: ShipmentAccess, record: ProblemReportRecord): Promise<Result<{ id: number }>>
}

// ── Documents ───────────────────────────────────────────────────────────────

export interface DocumentRecord {
  readonly id: number
  readonly type: string
  readonly storagePath: string
  readonly createdAt: string | null
}

export interface DocumentRepository {
  findByPath(actor: ActorContext, storagePath: string): Promise<Result<DocumentRecord | null>>
  insert(actor: ActorContext, input: { loadId: number; type: string; storagePath: string }): Promise<Result<DocumentRecord>>
  listForLoad(actor: ActorContext, loadId: number, type: string): Promise<Result<readonly DocumentRecord[]>>
}

/** Object bytes never pass through the application; it only mints and checks access. */
export interface ObjectStorage {
  createUploadUrl(path: string): Promise<Result<string>>
  exists(path: string): Promise<Result<boolean>>
  createDownloadUrl(path: string, ttlSeconds: number): Promise<Result<string>>
  remove(paths: readonly string[]): Promise<Result<void>>
}
