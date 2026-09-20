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
  })
}

import { ProfilePreferencesService } from './application/profile-preferences-service'
import { SupabaseProfileWriteRepository } from './infrastructure/supabase/profile-write-repository'

export function createProfilePreferencesService(supabase: SupabaseClient<Database>): ProfilePreferencesService {
  return new ProfilePreferencesService({ profiles: new SupabaseProfileWriteRepository(supabase) })
}

import { DriverActionService } from './application/driver-action-service'
import { SupabaseDriverActionRepository } from './infrastructure/supabase/driver-action-repository'
import { SupabaseIdempotencyRepository } from './infrastructure/supabase/idempotency-repository'

export function createDriverActionService(supabase: SupabaseClient<Database>): DriverActionService {
  return new DriverActionService({
    shipments: new SupabaseShipmentCommandRepository(supabase),
    actions: new SupabaseDriverActionRepository(supabase),
    // Idempotency runs as service_role, scoped by the verified actor in every statement.
    idempotency: new SupabaseIdempotencyRepository(createAdminClient()),
    clock: { now: () => new Date() },
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
  return new InvoiceService({ invoices: new SupabaseInvoiceWriteRepository(supabase), clock: { now: () => new Date() } })
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
