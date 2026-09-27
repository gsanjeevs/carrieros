// server/composition.ts
// The one place concrete adapters are wired to application services. Callers
// (API route handlers and web Server Components) pass in the request-scoped
// Supabase client; nothing here holds a module-level client, so tenant scoping
// is always the caller's own session.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { LoadQueryService } from './application/load-query-service'
import { SupabaseLoadReadRepository } from './infrastructure/supabase/load-read-repository'

export function createLoadQueryService(supabase: SupabaseClient<Database>): LoadQueryService {
  return new LoadQueryService({ loads: new SupabaseLoadReadRepository(supabase) })
}

// The change feed is read with the service role (client roles have no access to
// change_events). Callers must only ever pass org ids from a verified ActorContext.
import { ChangeFeedService } from './application/change-feed-service'
import { SupabaseChangeFeedRepository } from './infrastructure/supabase/change-feed-repository'
import { createAdminClient } from '@/lib/supabase/server'

export function createChangeFeedService(): ChangeFeedService {
  return new ChangeFeedService({
    feed: new SupabaseChangeFeedRepository(createAdminClient()),
    clock: { now: () => new Date() },
  })
}

import { ShipmentMilestoneService } from './application/shipment-milestone-service'
import { SupabaseShipmentCommandRepository } from './infrastructure/supabase/shipment-command-repository'

export function createShipmentMilestoneService(supabase: SupabaseClient<Database>): ShipmentMilestoneService {
  return new ShipmentMilestoneService({
    shipments: new SupabaseShipmentCommandRepository(supabase),
    clock: { now: () => new Date() },
    webhooks: createWebhookDispatchService(),
  })
}

import { ProfilePreferencesService } from './application/profile-preferences-service'
import { ProfileAvatarService } from './application/profile-avatar-service'
import { SupabaseProfileWriteRepository } from './infrastructure/supabase/profile-write-repository'

export function createProfilePreferencesService(supabase: SupabaseClient<Database>): ProfilePreferencesService {
  return new ProfilePreferencesService({ profiles: new SupabaseProfileWriteRepository(supabase) })
}

export function createProfileAvatarService(supabase: SupabaseClient<Database>): ProfileAvatarService {
  return new ProfileAvatarService({
    profiles: new SupabaseProfileWriteRepository(supabase),
    storage: new SupabaseObjectStorage(createStorageProvider(supabase)),
    ids: { uuid: () => crypto.randomUUID() },
  })
}

import { DriverActionService } from './application/driver-action-service'
import { SupabaseDriverActionRepository } from './infrastructure/supabase/driver-action-repository'
import { SupabaseIdempotencyRepository } from './infrastructure/supabase/idempotency-repository'
// SupabaseObjectStorage/createStorageProvider are imported once, below, by
// createDocumentService -- ESM import bindings are hoisted, so this earlier
// factory can still use them without a second (duplicate, build-error) import.

export function createDriverActionService(supabase: SupabaseClient<Database>): DriverActionService {
  return new DriverActionService({
    shipments: new SupabaseShipmentCommandRepository(supabase),
    actions: new SupabaseDriverActionRepository(supabase),
    // Idempotency runs as service_role, scoped by the verified actor in every statement.
    idempotency: new SupabaseIdempotencyRepository(createAdminClient()),
    clock: { now: () => new Date() },
    storage: new SupabaseObjectStorage(createStorageProvider(supabase)),
  })
}

import { DocumentService } from './application/document-service'
import { SupabaseDocumentRepository } from './infrastructure/supabase/document-repository'
import { SupabaseObjectStorage } from './infrastructure/supabase/object-storage'
import { createStorageProvider } from '@/lib/storage'

export function createDocumentService(supabase: SupabaseClient<Database>): DocumentService {
  return new DocumentService({
    shipments: new SupabaseShipmentCommandRepository(supabase),
    documents: new SupabaseDocumentRepository(supabase),
    storage: new SupabaseObjectStorage(createStorageProvider(supabase)),
    ids: { uuid: () => crypto.randomUUID() },
    idempotency: new SupabaseIdempotencyRepository(createAdminClient()),
  })
}

import { InvoiceService } from './application/invoice-service'
import { SupabaseInvoiceWriteRepository } from './infrastructure/supabase/invoice-write-repository'

export function createInvoiceService(supabase: SupabaseClient<Database>): InvoiceService {
  return new InvoiceService({
    invoices: new SupabaseInvoiceWriteRepository(supabase),
    clock: { now: () => new Date() },
    webhooks: createWebhookDispatchService(),
  })
}

import { FieldActionsService } from './application/field-actions-service'
import {
  SupabaseDriverSelfRepository,
  SupabaseFleetRepository,
  SupabaseLoadLocationRepository,
  SupabaseMessageRepository,
} from './infrastructure/supabase/field-actions-repository'

export function createFieldActionsService(supabase: SupabaseClient<Database>): FieldActionsService {
  return new FieldActionsService({
    shipments: new SupabaseShipmentCommandRepository(supabase),
    messages: new SupabaseMessageRepository(supabase),
    locations: new SupabaseLoadLocationRepository(supabase),
    driverSelf: new SupabaseDriverSelfRepository(supabase),
    fleet: new SupabaseFleetRepository(supabase),
    idempotency: new SupabaseIdempotencyRepository(createAdminClient()),
    clock: { now: () => new Date() },
  })
}

import { IftaService } from './application/ifta-service'
import { SupabaseFeatureGate, SupabaseIftaRepository } from './infrastructure/supabase/ifta-repository'

export function createIftaService(supabase: SupabaseClient<Database>): IftaService {
  return new IftaService({
    shipments: new SupabaseShipmentCommandRepository(supabase),
    ifta: new SupabaseIftaRepository(supabase),
    features: new SupabaseFeatureGate(supabase),
    idempotency: new SupabaseIdempotencyRepository(createAdminClient()),
    clock: { now: () => new Date() },
  })
}

export function createFeatureGate(supabase: SupabaseClient<Database>): SupabaseFeatureGate {
  return new SupabaseFeatureGate(supabase)
}

import { DvirService } from './application/dvir-service'
import { SupabaseDvirRepository } from './infrastructure/supabase/dvir-repository'

export function createDvirService(supabase: SupabaseClient<Database>): DvirService {
  return new DvirService({
    shipments: new SupabaseShipmentCommandRepository(supabase),
    dvir: new SupabaseDvirRepository(supabase),
    storage: new SupabaseObjectStorage(createStorageProvider(supabase)),
    ids: { uuid: () => crypto.randomUUID() },
    idempotency: new SupabaseIdempotencyRepository(createAdminClient()),
  })
}

import { DvirQueryService } from './application/dvir-query-service'
import { SupabaseDvirQueryRepository } from './infrastructure/supabase/dvir-query-repository'

export function createDvirQueryService(supabase: SupabaseClient<Database>): DvirQueryService {
  return new DvirQueryService({
    dvir: new SupabaseDvirQueryRepository(supabase),
    shipments: new SupabaseShipmentCommandRepository(supabase),
  })
}

import { FleetQueryService } from './application/fleet-query-service'
import { SupabaseFleetQueryRepository } from './infrastructure/supabase/fleet-query-repository'

export function createFleetQueryService(supabase: SupabaseClient<Database>): FleetQueryService {
  const fleet = new SupabaseFleetQueryRepository(supabase)
  return new FleetQueryService({ fleet, signPhoto: (path) => fleet.photoUrl(path) })
}

import { InvoiceQueryService } from './application/invoice-query-service'
import { SupabaseInvoiceQueryRepository } from './infrastructure/supabase/invoice-query-repository'

export function createInvoiceQueryService(supabase: SupabaseClient<Database>): InvoiceQueryService {
  return new InvoiceQueryService({ invoices: new SupabaseInvoiceQueryRepository(supabase) })
}

import { ExceptionQueryService } from './application/exception-query-service'
import { SupabaseExceptionQueryRepository } from './infrastructure/supabase/exception-query-repository'

export function createExceptionQueryService(supabase: SupabaseClient<Database>): ExceptionQueryService {
  return new ExceptionQueryService({ exceptions: new SupabaseExceptionQueryRepository(supabase) })
}

import { CustomerQueryService } from './application/customer-query-service'
import { SupabaseCustomerQueryRepository } from './infrastructure/supabase/customer-query-repository'

export function createCustomerQueryService(supabase: SupabaseClient<Database>): CustomerQueryService {
  return new CustomerQueryService({ customers: new SupabaseCustomerQueryRepository(supabase) })
}

import { BillingQueryService } from './application/billing-query-service'
import { SupabaseBillingQueryRepository } from './infrastructure/supabase/billing-query-repository'

export function createBillingQueryService(supabase: SupabaseClient<Database>): BillingQueryService {
  return new BillingQueryService({ billing: new SupabaseBillingQueryRepository(supabase) })
}

import { SettlementQueryService } from './application/settlement-query-service'
import { SupabaseSettlementQueryRepository } from './infrastructure/supabase/settlement-query-repository'

export function createSettlementQueryService(supabase: SupabaseClient<Database>): SettlementQueryService {
  return new SettlementQueryService({
    settlements: new SupabaseSettlementQueryRepository(supabase),
    shipments: new SupabaseShipmentCommandRepository(supabase),
    features: new SupabaseFeatureGate(supabase),
  })
}

import { DashboardQueryService } from './application/dashboard-query-service'
import { SupabaseDashboardQueryRepository } from './infrastructure/supabase/dashboard-query-repository'

export function createDashboardQueryService(supabase: SupabaseClient<Database>): DashboardQueryService {
  return new DashboardQueryService({ dashboard: new SupabaseDashboardQueryRepository(supabase) })
}

// Public developer API (Phase 9). oauth_clients/oauth_client_rate_limits have zero authenticated/anon
// grants (migration 0025) — there is no Supabase session for either the Settings-page management flow or
// the external caller's token exchange to key RLS off, so both always run as service_role, same posture as
// createChangeFeedService above.
import { OAuthClientService } from './application/oauth-client-service'
import { PublicApiTokenService } from './application/public-api-token-service'
import {
  SupabaseOAuthClientRepository,
  SupabasePublicApiEntitlementGate,
  SupabasePublicApiRateLimiter,
} from './infrastructure/supabase/oauth-client-repository'
import { NodeOAuthCredentialProvider } from './infrastructure/crypto/oauth-credentials'

export function createOAuthClientService(): OAuthClientService {
  const admin = createAdminClient()
  return new OAuthClientService({
    clients: new SupabaseOAuthClientRepository(admin),
    credentials: new NodeOAuthCredentialProvider(),
  })
}

export function createPublicApiTokenService(): PublicApiTokenService {
  const admin = createAdminClient()
  return new PublicApiTokenService({
    clients: new SupabaseOAuthClientRepository(admin),
    credentials: new NodeOAuthCredentialProvider(),
    entitlements: new SupabasePublicApiEntitlementGate(admin),
    rateLimiter: new SupabasePublicApiRateLimiter(admin),
  })
}

// Shared by every /api/public/v1/** data route (not just the token exchange) — a valid JWT still gets
// rate-limited per request, keyed by the client_id embedded in it at issuance.
export function createPublicApiRateLimiter(): SupabasePublicApiRateLimiter {
  return new SupabasePublicApiRateLimiter(createAdminClient())
}

import { LoadExpenseService } from './application/load-expense-service'
import { SupabaseLoadExpenseRepository } from './infrastructure/supabase/load-expense-repository'

export function createLoadExpenseService(supabase: SupabaseClient<Database>): LoadExpenseService {
  return new LoadExpenseService({
    shipments: new SupabaseShipmentCommandRepository(supabase),
    expenses: new SupabaseLoadExpenseRepository(supabase),
    idempotency: new SupabaseIdempotencyRepository(createAdminClient()),
  })
}

import { FinancialEventQueryService } from './application/financial-event-query-service'
import { SupabaseFinancialEventQueryRepository } from './infrastructure/supabase/financial-event-query-repository'

export function createFinancialEventQueryService(): FinancialEventQueryService {
  // Reads outbox_events, which is deny-all to `authenticated` (0005) — same
  // reasoning as createChangeFeedService: the service role is the only
  // legitimate reader, scoped explicitly by the verified actor's org id.
  return new FinancialEventQueryService({
    events: new SupabaseFinancialEventQueryRepository(createAdminClient()),
  })
}

import { OnboardingService } from './application/onboarding-service'
import { SetupWriteService } from './application/setup-write-service'
import { DriverMessageService } from './application/driver-message-service'
import { SupabaseOnboardingRepository, SupabaseSetupRepository } from './infrastructure/supabase/setup-repository'
import { createStripeCustomer } from '@/lib/stripe'

export function createOnboardingService(supabase: SupabaseClient<Database>): OnboardingService {
  return new OnboardingService({ onboarding: new SupabaseOnboardingRepository(supabase, createAdminClient()) })
}

export function createSetupWriteService(supabase: SupabaseClient<Database>): SetupWriteService {
  const setup = new SupabaseSetupRepository(supabase, createAdminClient())
  return new SetupWriteService({
    billing: setup,
    customers: setup,
    vehicles: setup,
    drivers: setup,
    idempotency: new SupabaseIdempotencyRepository(createAdminClient()),
    createStripeCustomer,
  })
}

import { SupabaseMessageTranslationRepository } from './infrastructure/supabase/message-translation-repository'
import { LlmTranslationProvider } from './infrastructure/ai/llm-translation-provider'

export function createDriverMessageService(supabase: SupabaseClient<Database>): DriverMessageService {
  return new DriverMessageService({
    shipments: new SupabaseShipmentCommandRepository(supabase),
    messages: new SupabaseMessageRepository(supabase),
    features: new SupabaseFeatureGate(supabase),
    idempotency: new SupabaseIdempotencyRepository(createAdminClient()),
    translations: new SupabaseMessageTranslationRepository(supabase),
    translator: new LlmTranslationProvider(),
  })
}

import { ConversationService } from './application/conversation-service'
import { SupabaseConversationRepository } from './infrastructure/supabase/conversation-repository'

export function createConversationService(supabase: SupabaseClient<Database>): ConversationService {
  return new ConversationService({ conversations: new SupabaseConversationRepository(supabase) })
}

import { OrgDocumentService } from './application/org-document-service'
import { SupabaseOrgDocumentRepository } from './infrastructure/supabase/org-document-repository'

export function createOrgDocumentService(supabase: SupabaseClient<Database>): OrgDocumentService {
  return new OrgDocumentService({
    documents: new SupabaseOrgDocumentRepository(supabase),
    storage: new SupabaseObjectStorage(createStorageProvider(supabase)),
    ids: { uuid: () => crypto.randomUUID() },
  })
}

import { LoadWriteService } from './application/load-write-service'
import { SupabaseLoadWriteRepository } from './infrastructure/supabase/load-write-repository'
import { ExpoPushGateway } from './infrastructure/push/expo-push-gateway'

export function createLoadWriteService(supabase: SupabaseClient<Database>): LoadWriteService {
  return new LoadWriteService({
    loads: new SupabaseLoadWriteRepository(supabase),
    features: new SupabaseFeatureGate(supabase),
    notifications: new ExpoPushGateway(),
    idempotency: new SupabaseIdempotencyRepository(createAdminClient()),
  })
}

import { InvoiceSendService } from './application/invoice-send-service'
import { SmtpEmailGateway } from './infrastructure/email/smtp-email-gateway'

export function createInvoiceSendService(supabase: SupabaseClient<Database>): InvoiceSendService {
  return new InvoiceSendService({
    invoices: new SupabaseInvoiceWriteRepository(supabase),
    email: new SmtpEmailGateway(),
    clock: { now: () => new Date() },
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  })
}

import { ErrorLogQueryService } from './application/error-log-query-service'
import { SupabaseErrorLogQueryRepository } from './infrastructure/supabase/error-log-query-repository'

export function createErrorLogQueryService(supabase: SupabaseClient<Database>): ErrorLogQueryService {
  return new ErrorLogQueryService({ errorLog: new SupabaseErrorLogQueryRepository(supabase) })
}

// Webhooks (Settings > Integrations, migration 0037). WebhookService is the
// Settings-surface CRUD, RLS-scoped by the caller's own client, same posture
// as vehicles/customers. WebhookDispatchService fires from inside another
// domain service's success path (see createInvoiceService/
// createShipmentMilestoneService above) with no session of its own, so its
// lookup + delivery recording run as service_role, same posture as
// createChangeFeedService.
import { WebhookService } from './application/webhook-service'
import { WebhookDispatchService } from './application/webhook-dispatch-service'
import { SupabaseWebhookRepository, SupabaseWebhookDeliveryWriter } from './infrastructure/supabase/webhook-repository'

export function createWebhookService(supabase: SupabaseClient<Database>): WebhookService {
  return new WebhookService({ webhooks: new SupabaseWebhookRepository(supabase, createAdminClient()) })
}

export function createWebhookDispatchService(): WebhookDispatchService {
  const admin = createAdminClient()
  return new WebhookDispatchService({
    webhooks: new SupabaseWebhookRepository(admin, admin),
    deliveries: new SupabaseWebhookDeliveryWriter(admin),
  })
}

// Settings > Integrations > Telematics -- same RLS-scoped-by-caller posture as
// createWebhookService above (owner_solo_telematics_integrations_all grants
// owner/solo direct tenant-scoped access, no service-role indirection needed
// for this CRUD surface). The Motive webhook receiver and Samsara poller use
// their own service-role admin-client queries directly (no caller session to
// scope by), not this service.
import { TelematicsIntegrationService } from './application/telematics-service'
import { SupabaseTelematicsIntegrationRepository } from './infrastructure/supabase/telematics-repository'

export function createTelematicsIntegrationService(supabase: SupabaseClient<Database>): TelematicsIntegrationService {
  return new TelematicsIntegrationService({ integrations: new SupabaseTelematicsIntegrationRepository(supabase) })
}

// Settings > Integrations > Load Board (migration 0052) -- DAT integration, Phase 1 (posting only,
// mocked client). Same RLS-scoped-by-caller posture as telematics above. MockDatClient stands in for
// a real DAT HTTP client until real API credentials exist (see its own file's header comment) --
// swapping it here is the only change a real integration needs.
import { LoadboardIntegrationService, LoadboardPostingService } from './application/loadboard-service'
import { SupabaseLoadboardIntegrationRepository, SupabaseLoadboardPostingRepository } from './infrastructure/supabase/loadboard-repository'
import { MockDatClient } from './infrastructure/loadboard/dat-client'

export function createLoadboardIntegrationService(supabase: SupabaseClient<Database>): LoadboardIntegrationService {
  return new LoadboardIntegrationService({
    integrations: new SupabaseLoadboardIntegrationRepository(supabase),
    features: new SupabaseFeatureGate(supabase),
  })
}

export function createLoadboardPostingService(supabase: SupabaseClient<Database>): LoadboardPostingService {
  return new LoadboardPostingService({
    integrations: new SupabaseLoadboardIntegrationRepository(supabase),
    postings: new SupabaseLoadboardPostingRepository(supabase),
    features: new SupabaseFeatureGate(supabase),
    datClient: new MockDatClient(),
  })
}
