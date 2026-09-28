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
import type { OAuthClientSummary } from '../domain/oauth/model'
import type { OnboardingDraft } from '../domain/onboarding/draft'
import type { LoadAssignmentPatch } from '../domain/load/write'
import type { WebhookDeliveryRecord, WebhookSummary } from '../domain/webhooks/model'
import type { TelematicsIntegrationSummary, TelematicsProvider } from '../domain/telematics/model'
import type { LoadboardIntegrationSummary, LoadboardPostingSummary, LoadboardProvider, LoadPostingResult } from '../domain/loadboard/model'

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

export interface CreateLoadRecord {
  readonly customer_name_raw: string | null
  readonly pickup_address: string | null
  readonly pickup_city: string | null
  readonly pickup_state: string | null
  readonly pickup_zip: string | null
  readonly pickup_date: string | null
  readonly pickup_time: string | null
  readonly delivery_address: string | null
  readonly delivery_city: string | null
  readonly delivery_state: string | null
  readonly delivery_zip: string | null
  readonly delivery_date: string | null
  readonly delivery_time: string | null
  readonly commodity: string | null
  readonly weight_lbs: number | null
  readonly rate: number | null
  readonly total_miles: number | null
  readonly intake_method: string
  readonly raw_intake_text: string | null
}

export interface LoadWriteRepository {
  create(actor: ActorContext, record: CreateLoadRecord): Promise<Result<{ id: number; loadNumber: string }>>
  assign(actor: ActorContext, loadId: number, patch: LoadAssignmentPatch): Promise<Result<boolean>>
  appendStatusEvent(actor: ActorContext, loadId: number, status: string): Promise<Result<void>>
  dispatchRecipient(actor: ActorContext, loadId: number): Promise<Result<{ pushToken: string | null; loadNumber: string } | null>>
  iftaMileageComplete(actor: ActorContext, loadId: number): Promise<Result<boolean | null>>
}

export interface PushNotificationGateway {
  send(input: { readonly to: string; readonly title: string; readonly body: string; readonly data: Record<string, unknown> }): Promise<void>
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
  getAvatarPath(actor: ActorContext): Promise<Result<string | null>>
  updateAvatarPath(actor: ActorContext, avatarPath: string | null): Promise<Result<void>>
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
  readonly receipt_path: string | null
}

export interface DriverActionRepository {
  createFuelStop(actor: ActorContext, load: ShipmentAccess, record: FuelStopRecord): Promise<Result<{ id: number }>>
  createProblemReport(actor: ActorContext, load: ShipmentAccess, record: ProblemReportRecord): Promise<Result<{ id: number }>>
  /** A load's fuel stops, oldest first. */
  listFuelStopsForLoad(actor: ActorContext, loadId: number): Promise<Result<readonly FuelStopReadRecord[]>>
  /** Ok(false) = no fuel stop with this id belongs to this org/load. */
  attachFuelStopReceipt(actor: ActorContext, loadId: number, fuelStopId: number, storagePath: string): Promise<Result<boolean>>
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

export interface OrgDocumentRecord {
  readonly id: number
  readonly docType: string
  readonly storagePath: string
  readonly expiryDate: string | null
  readonly createdAt: string | null
}

/** Company-level compliance documents (COI, MC authority, DOT cert, UCR, W-9,
 * business license) — org_documents table + storage convention already exist
 * (built for the web app); this is the /api/v1 path mobile needs. */
export interface OrgDocumentRepository {
  findByPath(actor: ActorContext, storagePath: string): Promise<Result<OrgDocumentRecord | null>>
  insert(actor: ActorContext, input: { docType: string; storagePath: string; expiryDate: string | null }): Promise<Result<OrgDocumentRecord>>
  list(actor: ActorContext): Promise<Result<readonly OrgDocumentRecord[]>>
  findById(actor: ActorContext, id: number): Promise<Result<OrgDocumentRecord | null>>
  delete(actor: ActorContext, id: number): Promise<Result<void>>
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
  findForSend(actor: ActorContext, invoiceId: number): Promise<Result<InvoiceSendRecord | null>>
  markSent(actor: ActorContext, invoiceId: number, sentAt: Date): Promise<Result<void>>
}

export interface InvoiceSendRecord {
  readonly invoiceNumber: string
  readonly amount: number
  readonly dueDate: string | null
  readonly recipient: string | null
  readonly customerName: string | null
  readonly loadTrackingToken: string | null
  /** Carrier org's currency (organizations.currency); null if unavailable. Resolve via lib/format-money.ts's resolveCurrency(), never a literal fallback. */
  readonly currency: string | null
}

export interface EmailGateway {
  send(input: { readonly to: string; readonly subject: string; readonly html: string }): Promise<Result<void>>
}

// ── Load expenses (T19 readiness layer) ──────────────────────────────────────

export interface LoadExpenseRecord {
  readonly expenseType: string
  readonly amount: number
  readonly note: string | null
}

export interface LoadExpenseCommandRepository {
  /** Atomic: load_expenses insert + outbox event. Idempotent on idempotencyKey. */
  record(
    actor: ActorContext,
    loadId: number,
    record: LoadExpenseRecord,
    idempotencyKey: string
  ): Promise<Result<{ id: number; amount: number; outcome: 'APPLIED' | 'REPLAYED' }>>
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
  resolveOriginalLanguage(actor: ActorContext): Promise<Result<string>>
  send(actor: ActorContext, loadId: number, body: string, originalLanguage: string): Promise<Result<{ id: number; sent_at: string }>>
  findById(actor: ActorContext, messageId: number): Promise<Result<{ id: number; body: string; loadId: number } | null>>
}

export interface ConversationSummary {
  readonly loadId: number
  readonly loadNumber: string
  readonly lastMessageBody: string
  readonly lastMessageAt: string
  readonly unreadCount: number
}

/** Dispatcher-facing aggregate inbox — never built before (legacy or v1); every
 * prior messages capability is scoped to one load's thread. */
export interface ConversationRepository {
  listForOrg(actor: ActorContext): Promise<Result<readonly ConversationSummary[]>>
}

export interface MessageTranslationRepository {
  findCached(messageId: number, targetLanguage: string): Promise<Result<string | null>>
  insert(messageId: number, targetLanguage: string, translatedBody: string): Promise<Result<string>>
}

/** Wraps the platform-wide LLM provider (lib/ai/) for translation. Never used
 * directly by application services — always through MessageTranslationRepository's
 * cache-then-translate flow, so a translation is never re-billed. */
export interface TranslationProvider {
  translate(text: string, targetLanguageName: string): Promise<Result<string>>
}

// ── Onboarding and mobile write-gap resources ──────────────────────────────

export interface OnboardingRepository {
  hasOrganization(userId: UserId): Promise<Result<boolean>>
  create(userId: UserId, draft: OnboardingDraft): Promise<Result<{ orgId: number; loadEmail: string | null }>>
}

export interface PaymentMethodRecord {
  readonly stripe_customer_id: string | null
  readonly card_brand: string | null
  readonly card_last4: string | null
  readonly billing_status: string | null
  readonly trial_ends_at: string | null
}

export interface PlanChangeRecord {
  readonly tier: string
  readonly amount: number
  readonly currency: string
  readonly event_id: number | null
  readonly event_status: string
}

export interface BillingWriteRepository {
  organizationName(actor: ActorContext): Promise<Result<string | null>>
  savePaymentMethod(actor: ActorContext, value: { stripeCustomerId: string; cardBrand: string; cardLast4: string }): Promise<Result<PaymentMethodRecord>>
  /** Atomically records a clearly simulated demo payment and applies the plan change. */
  changeTier(actor: ActorContext, tier: string, paymentReference: string): Promise<Result<PlanChangeRecord>>
}

export interface CreateCustomerInput {
  readonly name: string
  readonly phone?: string | null
  readonly email?: string | null
  readonly address?: string | null
  readonly city?: string | null
  readonly state?: string | null
  readonly zip?: string | null
  readonly country?: string | null
  readonly contactName?: string | null
  readonly notes?: string | null
}

export interface UpdateCustomerInput {
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
  /** True when the caller's request body included this field at all, so an
   * explicit `null` (clear it) can be told apart from "not provided". */
  readonly contactNameProvided: boolean
  readonly notesProvided: boolean
}

export interface CustomerWriteRepository {
  create(actor: ActorContext, input: CreateCustomerInput): Promise<Result<{ org_id: number; name: string; customer_number: string | null }>>
  update(actor: ActorContext, customerOrgId: number, input: UpdateCustomerInput): Promise<Result<{ org_id: number; name: string; customer_number: string | null }>>
}

export interface CreateVehicleInput {
  readonly vehicleTypeId: number
  readonly nickname: string
  readonly year?: number | null
  readonly make?: string | null
  readonly model?: string | null
  readonly vin?: string | null
  readonly licensePlate?: string | null
  readonly licenseState?: string | null
  readonly cabType?: string | null
  readonly color?: string | null
  readonly dimensions?: string | null
  // NOTE: named snake_case (not camelCase like the rest of this interface) deliberately —
  // app/api/v1/vehicles/[id]/route.ts passes UpdateVehicleBodySchema's parsed body straight through
  // as this type without a camelCase mapping step (same passthrough the pre-existing licensePlate/
  // licenseState/cabType fields above rely on, which only actually work today because a
  // single-word field name is spelled identically in snake_case and camelCase — a latent bug for
  // the multi-word fields, out of scope here). Matching the real snake_case shape here is what
  // makes setup-repository.ts's `key in input` lookup for these two fields actually fire.
  readonly telematics_provider?: 'samsara' | 'motive' | null
  readonly telematics_device_id?: string | null
}

export type UpdateVehicleInput = Partial<CreateVehicleInput>

export interface VehicleWriteRepository {
  create(actor: ActorContext, input: CreateVehicleInput): Promise<Result<{ vehicle_number: string | null; nickname: string }>>
  update(actor: ActorContext, vehicleId: number, input: UpdateVehicleInput): Promise<Result<{ vehicle_number: string | null; nickname: string } | null>>
}

export interface DriverSummaryRecord {
  readonly id: number
  readonly driver_number: string | null
  readonly invite_status: string | null
  readonly default_vehicle_id: number | null
  readonly cdl_expiry: string | null
  readonly med_cert_expiry: string | null
  readonly is_active: boolean | null
  readonly first_name: string | null
  readonly last_name: string | null
  readonly phone: string | null
}

export interface DriverDirectoryRepository {
  listActive(actor: ActorContext): Promise<Result<readonly DriverSummaryRecord[]>>
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

export interface IftaStateTax {
  readonly state: string
  readonly miles_in_state: number
  readonly net_tax_due: number
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
  /** get_ifta_tax_summary(): Pro-tier per-state net tax due, same RPC app/(app)/finance/page.tsx
   * already calls for its on-screen breakdown table -- used here for the CSV export so the two can
   * never disagree. */
  taxSummary(actor: ActorContext, quarter: string): Promise<Result<readonly IftaStateTax[]>>
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

// ── Public developer API (Phase 9) ──────────────────────────────────────────
// A genuinely different trust boundary: the caller authenticates as an
// ORGANIZATION via an OAuth 2.0 client-credentials grant, not as a logged-in
// human with a Supabase session. There is no session for RLS to key off, so
// every implementation of these runs as service_role and does its own org
// scoping — same posture as ChangeFeedRepository/IdempotencyRepository.

export interface OAuthCredentialProvider {
  /** A public, logged-safe identifier, e.g. "pub_client_<hex>". */
  newClientId(): string
  /** The RAW secret. Shown to the caller exactly once; never persisted as-is. */
  newClientSecret(): string
  hashSecret(secret: string): Promise<string>
  /** Constant-time comparison against a stored hash. */
  verifySecret(secret: string, hash: string): Promise<boolean>
}

/** Only the token-issuance path needs the hash and org id together — the UI-facing type is OAuthClientSummary. */
export interface OAuthClientRecord {
  readonly id: number
  readonly orgId: OrgId
  readonly clientId: string
  readonly clientSecretHash: string
  readonly revokedAt: string | null
}

export interface OAuthClientRepository {
  listForOrg(orgId: OrgId): Promise<Result<readonly OAuthClientSummary[]>>
  create(orgId: OrgId, name: string, clientId: string, secretHash: string): Promise<Result<OAuthClientSummary>>
  /** Ok(false) = no active client with this id belongs to this org (already revoked, or someone else's). */
  revoke(orgId: OrgId, clientId: string): Promise<Result<boolean>>
  /**
   * Cross-org lookup by client_id alone. The only place this is legitimate: the caller has not yet
   * proven which org they act for — determining that is this call's entire job.
   */
  findActiveByClientId(clientId: string): Promise<Result<OAuthClientRecord | null>>
  markUsed(clientId: string): Promise<Result<void>>
}

export interface PublicApiEntitlementGate {
  /**
   * entitlement_decision(org_id, 'public_api') directly, bypassing has_feature()'s reliance on
   * my_org_id() — this caller has no session for that to read. Internal/service_role-only RPC.
   */
  checkPublicApiAccess(orgId: OrgId): Promise<Result<{ allowed: boolean; reason: string }>>
}

export interface PublicApiRateLimiter {
  /** Atomic check-and-increment against the fixed window. retryAfterSeconds is 0 when allowed. */
  checkAndIncrement(clientId: string): Promise<Result<{ allowed: boolean; retryAfterSeconds: number }>>
}

// ── Financial events (T19 readiness layer) ───────────────────────────────────

/** Raw outbox row for a financial event, before categorization (categorize() is pure domain logic, not a query). */
export interface FinancialOutboxRecord {
  readonly id: number
  readonly eventType: string
  readonly payload: Record<string, unknown>
  readonly occurredAt: string
}

export interface FinancialEventQueryRepository {
  /**
   * Financial outbox events for this org, ordered by id ascending, starting
   * strictly after `cursor` (0/undefined = from the beginning). The org's own
   * currency, resolved once per call (Rule I: no literal fallback).
   */
  listSince(
    actor: ActorContext,
    cursor: number,
    limit: number
  ): Promise<Result<{ events: readonly FinancialOutboxRecord[]; currency: string }>>
}

// ── Platform-admin Debug/Error Log viewer (migration 0038) ──────────────────

export interface ErrorLogRow {
  readonly id: number
  readonly route: string
  readonly message: string
  readonly level: string
  readonly orgId: number | null
  readonly orgName: string | null
  readonly userId: string | null
  readonly requestId: string | null
  readonly context: Record<string, unknown> | null
  readonly createdAt: string
}

export interface ErrorLogFilters {
  readonly routeContains?: string
  readonly orgId?: number
  readonly from?: string
  readonly to?: string
  readonly limit: number
  readonly offset: number
}

// No ActorContext here (unlike every other query repository in this file) --
// this is a cross-tenant platform-admin read, gated by requireAdminRole()'s
// service-role client, the same posture app/api/admin/audit's route already
// uses for admin_events. There is no per-org actor to scope by.
export interface ErrorLogQueryRepository {
  list(filters: ErrorLogFilters): Promise<Result<{ readonly rows: readonly ErrorLogRow[]; readonly total: number }>>
}

// ── Webhooks (Settings > Integrations) ───────────────────────────────────────
// Org-scoped, RLS-backed CRUD — unlike OAuthClientRepository above, callers
// here always carry a normal session-authenticated ActorContext, so the
// caller's own Supabase client (RLS-scoped) is the right adapter, not
// service_role. See migration 0037.

export interface WebhookRecord {
  readonly id: number
  readonly orgId: OrgId
  readonly url: string
  /** Raw secret, used only for HMAC signing at dispatch time. */
  readonly secret: string
  readonly subscribedEvents: readonly string[]
  readonly enabled: boolean
}

export interface WebhookRepository {
  listForOrg(actor: ActorContext): Promise<Result<readonly WebhookSummary[]>>
  create(
    actor: ActorContext,
    input: { url: string; secret: string; subscribedEvents: readonly string[] }
  ): Promise<Result<WebhookSummary>>
  update(
    actor: ActorContext,
    webhookId: number,
    patch: { url?: string; subscribedEvents?: readonly string[]; enabled?: boolean }
  ): Promise<Result<WebhookSummary | null>>
  /** Ok(false) = no webhook with this id belongs to this org. */
  delete(actor: ActorContext, webhookId: number): Promise<Result<boolean>>
  rotateSecret(actor: ActorContext, webhookId: number, newSecret: string): Promise<Result<WebhookSummary | null>>
  listDeliveries(actor: ActorContext, webhookId: number, limit: number): Promise<Result<readonly WebhookDeliveryRecord[]>>
  /**
   * Cross-caller lookup for dispatch: every enabled webhook in `orgId`
   * subscribed to `eventType`, WITH its raw secret. Runs as service_role
   * (WebhookDispatchService has no human session — it fires from inside
   * another request's success path) so org scoping is enforced in the query
   * itself, same posture as OAuthClientRepository.findActiveByClientId.
   */
  findEnabledForDispatch(orgId: OrgId, eventType: string): Promise<Result<readonly WebhookRecord[]>>
}

export interface WebhookDeliveryWriter {
  /** Records one delivery attempt (service_role — dispatch has no session). Returns the delivery id. */
  recordAttempt(input: {
    webhookId: number
    orgId: OrgId
    eventType: string
    payload: Record<string, unknown>
    status: 'success' | 'failed'
    attemptCount: number
    responseStatus: number | null
  }): Promise<Result<number>>

}

// ── Telematics (migration 0042) ──────────────────────────────────────────────
// Settings > Integrations > Telematics: one row per (org, provider) vendor
// credential. The RLS-scoped caller's own session (owner/solo) has direct
// table access, same posture as WebhookRepository above -- no cross-tenant
// boundary to cross, so no RPC/service-role indirection is needed here either.

export interface TelematicsIntegrationRepository {
  listForOrg(actor: ActorContext): Promise<Result<readonly TelematicsIntegrationSummary[]>>
  /**
   * Upserts the org's row for `provider`. `apiKey`/`webhookSecret` are ALREADY app-layer encrypted
   * (lib/crypto/secrets.ts) by the caller (TelematicsIntegrationService) before this repository ever
   * sees them -- undefined leaves the stored credential untouched, null clears it, a string
   * (re)sets it. Only the field matching `provider` is ever meaningful; the service enforces that.
   */
  upsert(
    actor: ActorContext,
    provider: TelematicsProvider,
    patch: { apiKeyEncrypted?: string | null; webhookSecretEncrypted?: string | null; enabled?: boolean }
  ): Promise<Result<TelematicsIntegrationSummary>>
}

// ── Loadboard (migration 0052) ───────────────────────────────────────────────
// DAT load-board integration, Phase 1 (posting only). Settings > Integrations
// > Load Board: one row per (org, provider) vendor credential -- same
// RLS-scoped-by-caller posture as TelematicsIntegrationRepository above (the
// caller's own session has direct tenant-scoped access; owner/solo/dispatcher
// per migration 0052's carrier_loadboard_integrations_all policy).

export interface LoadboardIntegrationRepository {
  listForOrg(actor: ActorContext): Promise<Result<readonly LoadboardIntegrationSummary[]>>
  /**
   * Upserts the org's row for `provider`. `apiKey` is ALREADY app-layer encrypted
   * (lib/crypto/secrets.ts) by the caller (LoadboardIntegrationService) before this repository ever
   * sees it -- undefined leaves the stored credential untouched, null clears it, a string
   * (re)sets it.
   */
  upsert(
    actor: ActorContext,
    provider: LoadboardProvider,
    patch: { apiKeyEncrypted?: string | null; enabled?: boolean }
  ): Promise<Result<LoadboardIntegrationSummary>>
  /** The decrypted-at-rest ciphertext for the org's active credential, or null if none/disabled. Only
   * ever called by LoadboardPostingService right before an outbound DatClient call -- never returned
   * to any API response. */
  getCredential(actor: ActorContext, provider: LoadboardProvider): Promise<Result<{ apiKeyEncrypted: string | null; enabled: boolean } | null>>
}

/**
 * Outbound gateway to a load-board vendor's posting API. Phase 1's only implementation
 * (MockDatClient, server/infrastructure/loadboard/dat-client.ts) is a deterministic fake -- no real
 * DAT API credentials exist yet, a separate business/partnership step. Kept here as a port (not a
 * concrete import in server/application) so swapping in a real HTTP-backed client later needs no
 * change to LoadboardPostingService.
 */
export interface LoadPostPayload {
  readonly loadId: number
  readonly originCity: string | null
  readonly originState: string | null
  readonly destinationCity: string | null
  readonly destinationState: string | null
  readonly pickupDate: string | null
  readonly equipmentType: string | null
  readonly weightLbs: number | null
  readonly rate: number | null
}

export interface DatClient {
  postLoad(payload: LoadPostPayload): Promise<LoadPostingResult>
}

/** Just the load fields a load-board posting payload needs -- see the LoadPostPayload port above. */
export interface LoadboardPostingLoadFields {
  readonly id: number
  readonly pickupCity: string | null
  readonly pickupState: string | null
  readonly deliveryCity: string | null
  readonly deliveryState: string | null
  readonly pickupDate: string | null
  readonly weightLbs: number | null
  readonly rate: number | null
}

// loadboard_postings -- append-only audit trail / "already posted" check for the load-detail "Post to
// DAT" button (migration 0052).
export interface LoadboardPostingRepository {
  getForLoad(actor: ActorContext, loadId: number, provider: LoadboardProvider): Promise<Result<LoadboardPostingSummary | null>>
  create(
    actor: ActorContext,
    loadId: number,
    provider: LoadboardProvider,
    result: LoadPostingResult
  ): Promise<Result<LoadboardPostingSummary>>
  /** Tenant-scoped load lookup (carrier_org_id = actor.orgId) -- returns null if the load doesn't
   * exist or isn't this actor's org's, same NOT_FOUND-vs-cross-tenant posture as every other
   * org-scoped read in this codebase. */
  getLoadForPosting(actor: ActorContext, loadId: number): Promise<Result<LoadboardPostingLoadFields | null>>
}
