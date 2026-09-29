# 02 — The domain and application layer

This is a walkthrough doc, meant to be read with the referenced files open
side by side. It covers `carrieros-web/server/domain/`,
`carrieros-web/server/application/`, and `carrieros-web/server/ports/`. It
does **not** cover `app/api/v1/**` (routes/transport) or
`server/infrastructure/` (Supabase adapters) — those are
[`03-api-and-public-api.md`](./03-api-and-public-api.md)'s territory.

Two terms used throughout, defined up front for anyone new to this style of
backend (you don't need a DDD background to follow along):

- **Port** — an interface that describes a capability the business logic
  needs (e.g. "look up a load," "tell me what time it is," "generate an id"),
  without saying how that capability is implemented. Application code depends
  on the interface, not on Supabase. This is what lets tests substitute a fake
  in-memory implementation instead of hitting a real database.
- **Use case** — one unit of orchestration: "assign a driver to a load,"
  "send an invoice." A use case coordinates domain rules and ports to make one
  business action happen. In this codebase, use cases live in
  `server/application/` as service classes.

## 1. Purpose

ADR [`0002-layered-server-architecture.md`](../adr/0002-layered-server-architecture.md)
explains why this split exists. Before it, business logic lived "wherever it
was first needed" — the ADR's audit found 376 direct Supabase calls on web
and 131 on mobile, and the load status state machine lived inside a React
component (`mobile src/app/load/[id].tsx`), which meant a status change and
its audit row were two separate, non-transactional writes with no single
place to test the rule.

The layering fixes that by giving each concern exactly one place to live and
enforcing the direction of dependency:

```
app/api/v1/**        transport   parse, authenticate, authorize, validate, delegate, map result → HTTP
server/application/  use cases   orchestration; depends on domain + ports
server/domain/       model       entities, value objects, state machines; PURE
server/ports/        interfaces  repositories, clock, ids, outbox, storage
server/infrastructure/ adapters  Supabase/Postgres implementations
```

Dependencies point inward only. `domain` imports nothing but `domain`.
`application` imports `domain` and `ports`, never a concrete adapter. Only
`infrastructure` knows Supabase exists. Practically, that means:

- **Domain rules are unit-testable with plain objects** — no database, no
  network, no framework. The ADR notes the entitlement domain's 24 tests run
  in 5ms because nothing touches a clock or a socket.
- **Authorization becomes layered**, not RLS-only: the application layer can
  enforce a policy in code, and the database's row-level security is a second,
  independent backstop.
- **Persistence is swappable** in principle — the domain and application
  layers don't know they're talking to Postgres via PostgREST.
- **`server/` (not `lib/`) was chosen deliberately.** `lib/` is already
  imported freely by components and route handlers, so anything placed inside
  it inherits that ambient reachability. `server/` is a new top-level
  directory that could be lifted into a standalone service later, and the
  boundary is visible in every import path.

The ADR is explicit that this is enforced *mechanically*, not by convention —
see [§5](#5-conventions-and-gotchas) below.

## 2. File structure

Real directory listings, `find carrieros-web/server/{domain,application,ports} -type d|f`, run 2026-09-28:

```
carrieros-web/server/
├── domain/                     # PURE business rules — entities, value objects, state machines.
│   │                            No React, Next.js, or Supabase imports (enforced, see §5).
│   ├── shared/                  # Cross-cutting domain primitives used by every other domain module
│   │   ├── result.ts             Result<T,E> — explicit success/failure return type (no throwing
│   │   │                         for expected business outcomes); DomainErrorCode list
│   │   ├── identity.ts           ActorContext, branded UserId/OrgId, ActorRole — the verified
│   │   │                         caller context every service receives
│   │   └── money.ts               money value type/helpers
│   ├── load/                    Load aggregate rules
│   │   ├── write.ts               validates/builds a load assignment patch (status, driver, vehicle)
│   │   ├── read-model.ts          shapes for LoadSummary / LoadDetail / LoadEvent
│   │   └── status-groups.ts       single source of truth for grouping load statuses into UI filters
│   ├── invoice/                 Invoice aggregate rules (draft.ts, send.ts)
│   ├── entitlement/              model.ts — the tier/capability/override decision engine
│   ├── driver/, driver-actions/, fleet/, customer/, compliance/, documents/,
│   │   events/, financial-events/, load-expense/, loadboard/, messaging/,
│   │   oauth/, onboarding/, profile/, shipment/, telematics/, translation/,
│   │   webhooks/                one subdirectory per bounded concept, same pattern:
│   │                            pure functions/types over that concept's data
│   └── (26 subdirectories total, one per business concept)
├── application/                 # Use-case orchestration. Depends on domain + ports, never on a
│   │                            concrete adapter or Next.js/Supabase directly.
│   ├── load-write-service.ts      LoadWriteService — create/assign a load (see §3, §4)
│   ├── load-query-service.ts      read-side queries for loads
│   ├── load-access.ts             shared load authorization helpers
│   ├── invoice-service.ts, invoice-send-service.ts, invoice-query-service.ts
│   ├── entitlement-service.ts     EntitlementService — wraps domain/entitlement/model.ts with a Clock port
│   ├── idempotency.ts             withIdempotency() helper used by mutating services
│   ├── driver-action-service.ts, driver-message-service.ts, dvir-service.ts,
│   │   dvir-query-service.ts, dashboard-query-service.ts, customer-query-service.ts,
│   │   billing-query-service.ts, change-feed-service.ts, conversation-service.ts,
│   │   document-service.ts, error-log-query-service.ts, exception-query-service.ts,
│   │   field-actions-service.ts, financial-event-query-service.ts, fleet-query-service.ts,
│   │   identity-service.ts, ifta-service.ts, loadboard-service.ts, oauth-client-service.ts,
│   │   onboarding-service.ts, org-document-service.ts, profile-avatar-service.ts,
│   │   profile-preferences-service.ts, public-api-token-service.ts,
│   │   settlement-query-service.ts, setup-write-service.ts, shipment-milestone-service.ts,
│   │   telematics-service.ts, webhook-dispatch-service.ts, webhook-service.ts
│   │                            one service class per use case group — 38 files total
├── ports/
│   └── index.ts                 every interface the application layer depends on: Clock,
│                                IdGenerator, Logger, UnitOfWork/TransactionScope, OutboxWriter,
│                                Repositories (EntitlementRepository, IdempotencyRepository,
│                                AuditRepository, LoadReadRepository, LoadWriteRepository, ...),
│                                PushNotificationGateway, FeatureGate — 1235 lines, one file,
│                                deliberately kept out of infrastructure (see excerpt in §3)
└── infrastructure/               Supabase/Postgres adapters implementing the ports above —
                                  out of scope for this doc, see 03-api-and-public-api.md
```

Notable naming pattern inside `application/`: files ending `-query-service.ts`
are read-only use cases, `-write-service.ts` or `-service.ts` handle
mutations. `load-write-service.ts` and `load-query-service.ts` sitting next to
each other for the same aggregate is typical of this split.

## 3. Key files

### `server/domain/shared/result.ts` — how failure is modeled

Domain and application code never throws for an expected business outcome
("this tender was already accepted," "invalid status"). Everything returns a
`Result<T, E>` that the caller must check. Exceptions are reserved for actual
faults (a dead database connection, a bug).

```ts
// carrieros-web/server/domain/shared/result.ts:15-24
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok
}
```

The `DomainErrorCode` union in the same file (e.g. `VALIDATION_FAILED`,
`ILLEGAL_TRANSITION`, `FORBIDDEN`, `NOT_FOUND`) is the vocabulary every layer
above shares — the transport layer maps these codes straight to HTTP
responses.

### `server/domain/shared/identity.ts` — `ActorContext`

Every application service method takes an `ActorContext` as its first
argument. It is deliberately never constructed from raw client input — only
from a verified Supabase JWT plus membership rows read server-side.

```ts
// carrieros-web/server/domain/shared/identity.ts:34-47
export type ActorRole =
  | 'owner'
  | 'solo'
  | 'driver'
  | 'dispatcher'
  | 'finance'
  | 'customer_admin'
  | 'customer_viewer'
  | 'sx_owner'
  | 'sx_finance'
  | 'sx_support'

export const PLATFORM_ROLES: readonly ActorRole[] = ['sx_owner', 'sx_finance', 'sx_support']
export const isPlatformRole = (r: ActorRole) => PLATFORM_ROLES.includes(r)
```

The file's own comment is worth repeating for QA: "a request body that names
a tenant is a *claim*, and claims are checked against this context — never
used in its place." If you're testing tenant-isolation bugs, this is the type
to look at.

### `server/domain/load/write.ts` — validating a load assignment

Pure validation with no side effects: given raw input, either return a
well-typed patch or a validation error. Nothing here talks to a database or
knows what a driver row looks like.

```ts
// carrieros-web/server/domain/load/write.ts:28-36
export function buildLoadAssignment(input: LoadAssignmentInput): Result<LoadAssignmentPatch> {
  if (input.driverId === undefined && input.vehicleId === undefined && input.status === undefined) {
    return err(validationFailed('Provide at least one field to update'))
  }
  if (input.status !== undefined && !LOAD_STATUSES.includes(input.status as (typeof LOAD_STATUSES)[number])) {
    return err(validationFailed('Invalid status', { status: 'INVALID' }))
  }
  return ok(input as LoadAssignmentPatch)
}
```

### `server/domain/entitlement/model.ts` — a real decision engine, and the Clock port in action

This is the file the ADR's "Clock and IdGenerator are ports" reasoning is
about: `decideEntitlement` takes `now: Date` as a plain argument rather than
calling `new Date()` itself, so the 8-step decision (platform kill switch →
capability exists → org is a carrier → deny override → subscription standing
→ retained-despite-delinquency → grant override → tier comparison) can be
tested against any point in time with no clock mocking.

```ts
// carrieros-web/server/domain/entitlement/model.ts:157-181
export function decideEntitlement(
  snapshot: EntitlementSnapshot,
  capabilityKey: CapabilityKey,
  now: Date
): EntitlementDecision {
  const flag = snapshot.platformFlags.find((f) => f.key === capabilityKey)
  if (flag && !flag.enabled) {
    return {
      allowed: false,
      reason: 'DISABLED_BY_PLATFORM_FLAG',
      detail: `Capability ${capabilityKey} is disabled platform-wide`,
    }
  }

  const capability = snapshot.capabilities.find((c) => c.key === capabilityKey)
  if (!capability) {
    // Fail closed. A typo'd key must never grant access — and this is a real
    // hazard, since has_feature() returns NULL (falsy, but not false) for an
    // unknown key today, so the two disagree only in how loudly they fail.
    return {
      allowed: false,
      reason: 'UNKNOWN_CAPABILITY',
      detail: `No capability is registered under the key "${capabilityKey}"`,
    }
  }
  // ... continues through subscription standing, overrides, tier comparison
```

Every branch returns a machine-readable `reason`, not a bare boolean — so the
API can tell a client *why* a feature is unavailable instead of forcing every
frontend to re-derive the tier logic to build an upgrade prompt.

### `server/ports/index.ts` — the interfaces application code is allowed to depend on

This single 1235-line file declares every port: `Clock`, `IdGenerator`,
`Logger`, `UnitOfWork`/`TransactionScope`, `OutboxWriter`, and the repository
interfaces (`EntitlementRepository`, `IdempotencyRepository`,
`AuditRepository`, `LoadReadRepository`, `LoadWriteRepository`, and more).
It's kept out of `infrastructure/` on purpose — the file's own header comment
explains why:

```ts
// carrieros-web/server/ports/index.ts:1-10
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
```

The `Clock` and `IdGenerator` ports themselves are tiny, which is the point:

```ts
// carrieros-web/server/ports/index.ts:34-45
export interface Clock {
  now(): Date
}

export interface IdGenerator {
  uuid(): string
}
```

Also worth reading in this file: the `Repositories` interface comment
(lines ~117-131) on why every repository method takes the `ActorContext` and
scopes by `actor.orgId` server-side — "the second line of tenant defence,
independent of RLS."

### `server/application/load-write-service.ts` — a use case orchestrating domain + ports

`LoadWriteService.assign` is the clearest example of what "application layer"
means here: it checks authorization, calls a pure domain function to validate
the patch, then drives multiple port calls (repository writes, a push
notification, a feature-gate check) — all through dependencies injected in
the constructor, never a module-level Supabase client.

```ts
// carrieros-web/server/application/load-write-service.ts:10-16
export class LoadWriteService {
  constructor(private readonly deps: {
    readonly loads: LoadWriteRepository
    readonly features: FeatureGate
    readonly notifications: PushNotificationGateway
    readonly idempotency: IdempotencyRepository
  }) {}
```

```ts
// carrieros-web/server/application/load-write-service.ts:48-66
async assign(actor: ActorContext, loadId: number, input: LoadAssignmentInput, idempotencyKey: string): Promise<Result<{
  outcome: 'APPLIED' | 'REPLAYED'
  loadId: number
  iftaMileageComplete?: boolean | null
}>> {
  if (!roleHasCapability(actor.role, 'loads_manage')) return err(forbidden('This role cannot assign loads', { role: actor.role }))
  const patch = buildLoadAssignment(input)
  if (!patch.ok) return patch

  return withIdempotency<{ outcome: 'APPLIED' | 'REPLAYED'; loadId: number; iftaMileageComplete?: boolean | null }>(this.deps.idempotency, actor, `PATCH /loads/${loadId}`, idempotencyKey, input, async () => {
    const updated = await this.deps.loads.assign(actor, loadId, patch.value)
    if (!updated.ok) return updated
    if (!updated.value) return { ok: false as const, error: { code: 'NOT_FOUND' as const, detail: 'Load not found' } }

    if (patch.value.status) {
      const event = await this.deps.loads.appendStatusEvent(actor, loadId, patch.value.status)
      if (!event.ok) return event
    }
```

## 4. How to trace a change end-to-end: assigning/dispatching a load

Concrete real example: `PATCH /api/v1/loads/{id}` — assigning a driver/vehicle
to a load, including the `dispatched` and `delivered` status transitions.
Files, in call order:

1. **Transport** — `carrieros-web/app/api/v1/loads/[id]/route.ts:38` (`PATCH`).
   Parses the request via `parseCommand`, then delegates in one line:
   ```ts
   // carrieros-web/app/api/v1/loads/[id]/route.ts:41
   const result = await createLoadWriteService(cmd.supabase).assign(cmd.actor, cmd.id, cmd.body, cmd.idempotencyKey)
   ```
   No `.from()`/`.rpc()` call here — that's the `v1-route-delegation` rule
   from §5 doing its job.

2. **Use case** — `LoadWriteService.assign` in
   `carrieros-web/server/application/load-write-service.ts:48`. Checks the
   `loads_manage` capability, validates the input, wraps the whole operation
   in `withIdempotency` (`server/application/idempotency.ts`) so a retried
   request with the same `Idempotency-Key` replays the prior result instead
   of double-assigning.

3. **Domain validation** — `buildLoadAssignment` in
   `carrieros-web/server/domain/load/write.ts:28`. Pure function: confirms at
   least one field was supplied and that `status`, if present, is one of the
   ten `LOAD_STATUSES` (`draft` → ... → `paid`/`cancelled`/`declined`,
   `carrieros-web/server/domain/load/write.ts:3-14`). No I/O.

4. **Ports invoked by the use case** (all interfaces from
   `carrieros-web/server/ports/index.ts`):
   - `LoadWriteRepository.assign` — persists the patch (`ports/index.ts:288`)
   - `LoadWriteRepository.appendStatusEvent` — records the status-change
     event, when `status` was part of the patch (`ports/index.ts:289`)
   - `LoadWriteRepository.dispatchRecipient` + `PushNotificationGateway.send`
     — only when the new status is `dispatched`, to notify the driver
   - `FeatureGate.hasFeature` + `LoadWriteRepository.iftaMileageComplete` —
     only when the new status is `delivered`, to report IFTA mileage-log
     completeness if the org is entitled to that feature
   - `IdempotencyRepository` — reserve/replay/complete around the whole
     operation

5. **Infrastructure** (out of scope for this doc, see
   `03-api-and-public-api.md` and `server/infrastructure/supabase/`) — the
   Supabase adapter implementing `LoadWriteRepository` is what actually issues
   the writes, routed through `app_execute_command` so the status write and
   its audit/outbox row commit in one transaction (see ADR 0002's "Cost
   accepted" paragraph on `UnitOfWork` over PostgREST).

If you're testing this in QA: to reproduce the `iftaMileageComplete` branch
you need an org entitled to `ifta_mileage_log` (see
`server/domain/entitlement/model.ts` for how that's decided) **and** a status
transition to `delivered`; to reproduce the push-notification branch you need
a transition to `dispatched` and a driver profile with a push token.

## 5. Conventions and gotchas

These are pulled from what's actually enforced by
`carrieros-web/scripts/check-architecture.mjs` (verified against ADR 0002,
2026-09-28) plus in-file comments — nothing invented:

- **`server-domain-purity`** (`scripts/check-architecture.mjs:85-92`):
  `server/domain/**/*.ts` must not import React, Next.js, `@supabase/*`,
  `@/components`, `@/lib/supabase`, or `@/app/*`. It may import only other
  `server/domain` modules. This is what makes `Result`, `decideEntitlement`,
  `buildLoadAssignment`, etc. runnable as plain functions in a test with no
  server running.
- **`server-application-purity`** (`scripts/check-architecture.mjs:97-105`):
  `server/application/**/*.ts` may import `server/domain` and `server/ports`
  only — never Next.js, React, Supabase, or a concrete adapter from
  `../infrastructure` / `@/server/infrastructure`. Dependencies must be
  injected through the service constructor (see `LoadWriteService` in §3)
  instead.
- **`server-ports-purity`** (`scripts/check-architecture.mjs:109-117`):
  `server/ports/**/*.ts` declares interfaces only — no Next.js, React,
  Supabase, or infrastructure imports. A port that imports its own adapter
  has inverted the dependency it exists to create.
- **`v1-route-delegation`** (`scripts/check-architecture.mjs:122-129`):
  `app/api/v1/**/*.ts` route handlers must not call `.from(...)` or
  `.rpc(...)` directly — they must delegate to an application service.
  Persistence belongs behind a repository port. (This is the rule the
  `loads/[id]/route.ts` handler in §4 satisfies.)
- All four are **hard errors, not warnings**, and have been since `server/`
  was created — the ADR's reasoning is that this is affordable only because
  there was no pre-existing violation to grandfather in a brand-new
  directory. Expect CI (or the architecture check script run locally) to
  fail the build if you add an import that crosses one of these boundaries.
- **No module-scope database client, ever.** Services take dependencies via
  constructor injection (`new LoadWriteService({ loads, features,
  notifications, idempotency })`), not a service locator or a shared client
  imported at module scope. The ADR's stated reason: "a global client is what
  makes tenant scoping invisible and tests require a live database."
- **Business outcomes return `Result`, they don't throw.** If you're writing
  or reviewing a test and see a `try/catch` around a call into
  `server/domain` or `server/application` for something like "invalid
  status" or "already assigned," that's a smell — those are supposed to come
  back as `{ ok: false, error }`.
- **`DomainErrorCode` values are a public contract.** They cross the API
  boundary verbatim and clients map them to localized copy. Renaming one is a
  breaking API change (`server/domain/shared/result.ts:29-33`).
- **Repository methods always take `ActorContext` and scope by
  `actor.orgId`**, never by an org id passed as a separate argument — this is
  the deliberate second line of tenant-isolation defense independent of RLS
  (`server/ports/index.ts:117-125`). If you see a repository method accepting
  a bare org id parameter, flag it.

## 6. See also

- [`architecture/adr/0002-layered-server-architecture.md`](../adr/0002-layered-server-architecture.md)
  — the decision record this doc is grounded in; read it first for the full
  context and consequences.
- [`architecture/walkthrough/03-api-and-public-api.md`](./03-api-and-public-api.md)
  — covers the transport layer (`app/api/v1/**`) that authenticates,
  authorizes, validates, and delegates into the application services
  described here.
