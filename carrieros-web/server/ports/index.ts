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
import type { LoadDetail, LoadEvent, LoadSummary } from '../domain/load/read-model'
import type { ChangeEntity } from '../domain/events/entities'
import type { PreferencesPatch } from '../domain/profile/preferences'
import type { DriverProfilePatch } from '../domain/driver/self-profile'

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
  /** One load plus its timeline. Null when missing, someone else's org, or (for a driver) not theirs. */
  getDetailForActor(
    actor: ActorContext,
    loadId: number,
    includeRate: boolean
  ): Promise<Result<{ load: LoadDetail; events: readonly LoadEvent[] } | null>>
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

export interface ProfilePreferencesRecord {
  readonly preferred_language: string | null
  readonly uom_system: 'imperial' | 'metric' | null
  readonly date_format: string | null
  readonly time_format: string | null
  readonly theme_preference: string | null
  /** carrier_details.uom_system for the actor's org — the fallback when the profile's own uom_system is null. */
  readonly org_default_uom_system: 'imperial' | 'metric'
}

/** Writes to the ACTOR'S OWN profile only: the row is chosen from actor.userId, never from a caller-supplied id. */
export interface ProfileWriteRepository {
  getPreferences(actor: ActorContext): Promise<Result<ProfilePreferencesRecord>>
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

export interface FuelStopReadRecord {
  readonly id: number
  readonly state: string
  readonly station: string | null
  readonly gallons: number
  readonly total_cost: number
}

export interface DriverActionRepository {
  createFuelStop(actor: ActorContext, load: ShipmentAccess, record: FuelStopRecord): Promise<Result<{ id: number }>>
  createProblemReport(actor: ActorContext, load: ShipmentAccess, record: ProblemReportRecord): Promise<Result<{ id: number }>>
  /** A load's fuel stops, oldest first. */
  listFuelStopsForLoad(actor: ActorContext, loadId: number): Promise<Result<readonly FuelStopReadRecord[]>>
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

// ── Invoices ────────────────────────────────────────────────────────────────

export interface InvoiceDraftPatch {
  readonly amount: number
  readonly dueDate: string | null
  readonly notes: string | null
}

export interface InvoiceWriteRepository {
  /** Updates the invoice only while it is still a draft. Ok(false) = no draft matched (missing, not yours, or already sent). */
  updateDraft(actor: ActorContext, invoiceId: number, patch: InvoiceDraftPatch): Promise<Result<boolean>>
  /** Atomic: invoice paid + its load paid. Idempotent. */
  markPaid(actor: ActorContext, invoiceId: number, paidAt: Date): Promise<Result<{ outcome: 'APPLIED' | 'ALREADY_PAID'; invoiceId: number }>>
}

// ── Messages, location, driver profile, fleet service ───────────────────────

export interface DriverMessageRecord {
  readonly id: number
  readonly sender_id: string | null
  readonly body: string
  readonly original_language: string | null
  readonly sent_at: string
  readonly read_at: string | null
}

export interface MessageRepository {
  /** Marks the given messages read, but only those on this load that the actor did not send. Returns how many changed. */
  markRead(actor: ActorContext, loadId: number, messageIds: readonly number[], readAt: Date): Promise<Result<number>>
  /** A load's message thread, oldest first. */
  listForLoad(actor: ActorContext, loadId: number): Promise<Result<readonly DriverMessageRecord[]>>
}

export interface LoadLocationRepository {
  /** Writes ONLY the three location columns, and only if the sample is newer than what is stored. */
  updateLocation(actor: ActorContext, loadId: number, sample: { latitude: number; longitude: number; recordedAt: Date }): Promise<Result<void>>
}

export interface DriverProfileRecord {
  readonly id: number
  readonly cdl_number: string | null
  readonly cdl_class: string | null
  readonly cdl_state: string | null
  readonly cdl_expiry: string | null
  readonly med_cert_expiry: string | null
  readonly endorsements: readonly string[]
  readonly emergency_contact_name: string | null
  readonly emergency_contact_phone: string | null
  readonly emergency_contact_relation: string | null
  readonly default_vehicle_id: number | null
}

export interface DriverSelfRepository {
  /** Updates the actor's OWN drivers row. Ok(false) = the actor has no driver record. */
  updateOwnProfile(actor: ActorContext, patch: DriverProfilePatch): Promise<Result<boolean>>
  vehicleInOrg(actor: ActorContext, vehicleId: number): Promise<Result<boolean>>
  /** The actor's OWN drivers row, or null when they have none (e.g. a solo owner). */
  getOwnProfile(actor: ActorContext): Promise<Result<DriverProfileRecord | null>>
}

export interface ReminderRecord {
  readonly id: number
  readonly triggerMonths: number | null
  readonly triggerMiles: number | null
}

export interface FleetRepository {
  findReminder(actor: ActorContext, vehicleId: number, reminderId: number): Promise<Result<ReminderRecord | null>>
  /** Insert the service log and (optionally) update its reminder in ONE transaction. */
  logService(
    actor: ActorContext,
    input: {
      vehicleId: number
      serviceType: string
      serviceDate: string
      odometer: number | null
      cost: number | null
      shopName: string | null
      notes: string | null
      reminderId: number | null
      nextDueDate: string | null
      nextDueMiles: number | null
    }
  ): Promise<Result<{ id: number }>>
}

// ── IFTA ────────────────────────────────────────────────────────────────────

export interface FeatureGate {
  hasFeature(actor: ActorContext, featureKey: string): Promise<Result<boolean>>
  /** Every feature key the actor's org currently has (get_my_entitlements()). */
  list(actor: ActorContext): Promise<Result<readonly string[]>>
}

// ── Fleet reads ─────────────────────────────────────────────────────────────

export interface VehicleSummaryRecord {
  readonly id: number
  readonly vehicle_number: string | null
  readonly nickname: string
  readonly status: string
  readonly photo_path: string | null
}

export interface ServiceLogRecord {
  readonly id: number
  readonly service_type: string
  readonly service_date: string
  readonly odometer: number | null
  readonly cost: number | null
  readonly shop_name: string | null
}

export interface MaintenanceReminderRecord {
  readonly id: number
  readonly reminderType: string
  readonly triggerMonths: number | null
  readonly triggerMiles: number | null
}

export interface FleetReminderRecord {
  readonly id: number
  readonly vehicleId: number
  readonly reminderType: string
  readonly nextDueDate: string | null
  readonly nextDueMiles: number | null
  readonly vehicle: { readonly vehicle_number: string | null; readonly nickname: string | null } | null
}

export interface FleetQueryRepository {
  listActiveForOrg(actor: ActorContext): Promise<Result<readonly VehicleSummaryRecord[]>>
  getDetailForActor(
    actor: ActorContext,
    vehicleId: number
  ): Promise<Result<{ vehicle: VehicleSummaryRecord; serviceLogs: readonly ServiceLogRecord[]; reminders: readonly MaintenanceReminderRecord[] } | null>>
  /** Fleet-wide active reminders, org scoped. Matches `carrier_reminders_select` (no role restriction). */
  listActiveReminders(actor: ActorContext): Promise<Result<readonly FleetReminderRecord[]>>
}

// ── Invoice reads ───────────────────────────────────────────────────────────

export interface InvoiceSummaryRecord {
  readonly id: number
  readonly invoice_number: string
  readonly amount: number
  readonly status: string
  readonly due_date: string | null
  readonly opened_at: string | null
}

export interface InvoiceDetailRecord extends InvoiceSummaryRecord {
  readonly notes: string | null
  readonly sent_at: string | null
  readonly paid_at: string | null
  readonly load_id: number | null
}

export interface InvoiceQueryRepository {
  listForOrg(actor: ActorContext): Promise<Result<readonly InvoiceSummaryRecord[]>>
  getForActor(actor: ActorContext, invoiceId: number): Promise<Result<InvoiceDetailRecord | null>>
}

// ── DVIR reads ──────────────────────────────────────────────────────────────

export interface DvirInspectionBrief {
  readonly id: number
  readonly type: string
  readonly created_at: string | null
}

export interface DvirHistoryItem {
  readonly id: number
  readonly type: string
  readonly condition: string
  readonly odometer: number | null
  readonly submitted_at: string
  readonly signature_url: string | null // already a short-lived signed url, or null if unsigned
  readonly vehicle: { readonly vehicle_number: string | null; readonly nickname: string } | null
  readonly driver_name: string | null
  readonly defects: readonly { readonly id: number; readonly area: string; readonly description: string | null; readonly severity: string | null }[]
}

export interface DvirQueryRepository {
  listForLoad(actor: ActorContext, loadId: number, type?: string): Promise<Result<readonly DvirInspectionBrief[]>>
  /** Scoped to the actor's own inspections when they are a driver, the whole org otherwise. */
  listForActor(actor: ActorContext, driverId: number | null): Promise<Result<readonly DvirHistoryItem[]>>
}

export interface IftaCrossingRecord {
  readonly id: number
  readonly state: string
  readonly odometer_est: number | null
  readonly source: string
}

export interface IftaStateMiles {
  readonly state: string
  readonly total_miles: number
}

export interface IftaRepository {
  insertGpsCrossing(
    actor: ActorContext,
    load: ShipmentAccess,
    record: { state: string; crossedAt: Date; latitude: number | null; longitude: number | null; driverId: number | null }
  ): Promise<Result<{ id: number }>>
  /** Atomic: delete the load's GPS crossings, insert the manual rows. Returns rows written. */
  replaceWithManual(actor: ActorContext, loadId: number, rows: readonly { state: string; miles: number }[]): Promise<Result<number>>
  /** A load's recorded crossings, earliest first. */
  listCrossingsForLoad(actor: ActorContext, loadId: number): Promise<Result<readonly IftaCrossingRecord[]>>
  /** check_ifta_completeness(): whether GPS-recorded miles cover >= 60% of the load's total_miles. */
  checkCompleteness(actor: ActorContext, loadId: number): Promise<Result<boolean>>
  /** get_ifta_quarterly_summary(): state mileage totals for the org's whole fleet in one quarter (e.g. "2026-Q3"). */
  quarterlySummary(actor: ActorContext, quarter: string): Promise<Result<readonly IftaStateMiles[]>>
}

// ── DVIR ────────────────────────────────────────────────────────────────────

export interface InspectionAccess {
  readonly id: number
  readonly driverId: number | null
}

// ── Exceptions ──────────────────────────────────────────────────────────────

export interface ExceptionRow {
  readonly entity_type: string
  readonly entity_id: number
  readonly exception_type: string
  readonly tier: string
  readonly title: string
  readonly detail: string
  readonly due_at: string | null
}

/** get_exceptions(): org-scoped and role-filtered entirely inside the SECURITY DEFINER RPC. */
export interface ExceptionQueryRepository {
  list(actor: ActorContext): Promise<Result<readonly ExceptionRow[]>>
}

// ── Customers ───────────────────────────────────────────────────────────────

export interface CustomerOrgInfo {
  readonly name: string
  readonly phone: string | null
  readonly email: string | null
}

export interface CustomerSummaryRecord {
  readonly org_id: number
  readonly contact_name: string | null
  readonly organization: CustomerOrgInfo | null
}

export interface CustomerDetailRecord {
  readonly org_id: number
  readonly customer_number: string | null
  readonly contact_name: string | null
  readonly tags: readonly string[] | null
  readonly notes: string | null
  readonly organization: (CustomerOrgInfo & { readonly city: string | null; readonly state: string | null }) | null
}

export interface CustomerLoadRecord {
  readonly id: number
  readonly load_number: string
  readonly status: string | null
  readonly rate: number | null
  readonly delivery_date: string | null
}

/** customer_details/organizations reads, matching `carrier_customer_select` (owner/solo/dispatcher/finance). */
export interface CustomerQueryRepository {
  listForOrg(actor: ActorContext): Promise<Result<readonly CustomerSummaryRecord[]>>
  getForActor(actor: ActorContext, customerOrgId: number): Promise<Result<CustomerDetailRecord | null>>
  recentLoadsForCustomer(actor: ActorContext, customerOrgId: number, limit: number): Promise<Result<readonly CustomerLoadRecord[]>>
  /** get_customer_health_score(); null when the org isn't entitled (customer_health_score feature). */
  healthScore(actor: ActorContext, customerOrgId: number): Promise<Result<number | null>>
}

// ── Billing ─────────────────────────────────────────────────────────────────

export interface BillingDetailsRecord {
  readonly tier: string | null
  readonly billing_status: string | null
  readonly trial_ends_at: string | null
  readonly stripe_customer_id: string | null
  readonly card_brand: string | null
  readonly card_last4: string | null
}

export interface TierPricingRecord {
  readonly included_trucks: number
  readonly price_per_additional_truck: number
}

/** carrier_details/tiers/vehicles reads. RLS on carrier_details has no role check; the
 * `subscription_management` capability (owner/solo) is enforced by the application layer. */
export interface BillingQueryRepository {
  getForOrg(actor: ActorContext): Promise<Result<BillingDetailsRecord | null>>
  activeVehicleCount(actor: ActorContext): Promise<Result<number>>
  /** Global tier catalog row (not org-scoped — `tiers_select` is `USING (true)`). */
  tierPricing(code: string): Promise<Result<TierPricingRecord | null>>
}

// ── Settlements ─────────────────────────────────────────────────────────────

export interface SettlementRecord {
  readonly id: number
  readonly pay_method: string
  readonly gross_revenue: number | null
  readonly net_pay: number | null
  readonly payment_status: string
  readonly period_start: string | null
  readonly period_end: string | null
  readonly driver: { readonly driver_number: string | null; readonly first_name: string | null; readonly last_name: string | null } | null
}

/** driver_settlements reads. driverId non-null narrows to that driver's own rows
 * (driver_own_settlements_select); null relies on org-wide staff access (owner/solo/finance). */
export interface SettlementQueryRepository {
  listForActor(actor: ActorContext, driverId: number | null): Promise<Result<readonly SettlementRecord[]>>
}

// ── Dashboard ───────────────────────────────────────────────────────────────

/** Deliberately narrower than LoadSummary: the dashboard card only ever
 * shows these 8 fields (mobile home.tsx's LoadRow), never rate/commodity/dates. */
export interface DashboardLoadRecord {
  readonly id: number
  readonly load_number: string
  readonly status: string
  readonly customer_name_raw: string | null
  readonly pickup_city: string | null
  readonly pickup_state: string | null
  readonly delivery_city: string | null
  readonly delivery_state: string | null
}

export interface DashboardOpsLoad extends DashboardLoadRecord {
  readonly driver_id: number | null
  readonly vehicle_id: number | null
  readonly updated_at: string | null
}

export interface DashboardInvoiceRecord {
  readonly id: number
  readonly invoice_number: string
  readonly amount: number
  readonly due_date: string | null
  readonly paid_at: string | null
}

/** One purpose-built read per role's dashboard content, org scoped throughout. */
export interface DashboardQueryRepository {
  activeLoadsCount(actor: ActorContext): Promise<Result<number>>
  fleetStatusCounts(actor: ActorContext): Promise<Result<{ active: number; idle: number; in_shop: number }>>
  recentLoads(actor: ActorContext, limit: number): Promise<Result<readonly DashboardLoadRecord[]>>
  /** The caller's own in-progress load, when they are a driver (solo's "My Load Today" card). */
  ownActiveLoad(actor: ActorContext): Promise<Result<DashboardLoadRecord | null>>
  opsLoads(actor: ActorContext): Promise<Result<readonly DashboardOpsLoad[]>>
  availableDriversCount(actor: ActorContext, assignedDriverIds: readonly number[]): Promise<Result<number>>
  availableVehiclesCount(actor: ActorContext, assignedVehicleIds: readonly number[]): Promise<Result<number>>
  outstandingInvoices(actor: ActorContext): Promise<Result<readonly { amount: number }[]>>
  overdueInvoices(actor: ActorContext, limit: number): Promise<Result<readonly DashboardInvoiceRecord[]>>
  recentPayments(actor: ActorContext, limit: number): Promise<Result<readonly DashboardInvoiceRecord[]>>
}

export interface DvirRepository {
  /** The actor's default vehicle (drivers.default_vehicle_id), when they are a driver. */
  findDefaultVehicle(actor: ActorContext): Promise<Result<number | null>>
  /** Inspection + its defects, atomically. Returns the new ids. */
  submit(
    actor: ActorContext,
    input: {
      loadId: number
      vehicleId: number | null
      driverId: number | null
      type: string
      condition: string
      odometer: number | null
      defects: readonly { area: string; description: string; severity: string }[]
    }
  ): Promise<Result<{ id: number; defects: readonly { id: number; area: string }[] }>>
  findInspection(actor: ActorContext, inspectionId: number): Promise<Result<InspectionAccess | null>>
  /** Point the inspection's signature, or one defect's photo, at an uploaded object. Ok(false) = nothing matched. */
  attach(actor: ActorContext, inspectionId: number, target: { kind: 'signature' } | { kind: 'defect_photo'; area: string }, storagePath: string): Promise<Result<boolean>>
}
