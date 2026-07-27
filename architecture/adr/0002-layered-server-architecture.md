# ADR 0002 — Layered server architecture under `carrieros-web/server/`

**Date:** 2026-07-26
**Status:** Accepted
**Supersedes:** nothing. Complements `docs/architecture-principles.md` Rules B/D/G.

## Context

Business logic currently lives wherever it was first needed: 41 unversioned
route handlers, React server components, client components (19 of which write
to tables directly), and `lib/`. The audit counted **376** direct Supabase
usages on web and **131** on mobile, including **157 writes** across both.

Three consequences:

1. Rules are unenforceable and untestable in isolation. The load status machine
   exists in a React component (`mobile src/app/load/[id].tsx`), so a status
   change and its audit row are two separate, non-transactional writes.
2. Authorization has one layer. For client-component writes, RLS is the *only*
   control.
3. The commercial gate is a SQL function that ignores five of the six columns
   that should feed it.

## Decision

Introduce a layered stack under `carrieros-web/server/`:

```
app/api/v1/**        transport   parse, authenticate, authorize, validate,
                                 delegate, map result → HTTP
server/application/  use cases   orchestration; depends on domain + ports
server/domain/       model       entities, value objects, state machines; PURE
server/ports/        interfaces  repositories, clock, ids, outbox, storage
server/infrastructure/ adapters  Supabase/Postgres implementations
```

Dependencies point inward only. `domain` imports nothing but `domain`.
`application` imports `domain` and `ports`. Only `infrastructure` knows Supabase
exists.

### Why `server/` rather than `lib/`

`lib/` is already imported freely by components and route handlers, so adding
layers inside it would inherit that ambient reachability. A separate top-level
directory can be **lifted wholesale** into a standalone Node service later —
which the brief requires — and the boundary is visible in every import path.

### Why enforcement is mechanical

`scripts/check-architecture.mjs` gained four hard-error rules
(`server-domain-purity`, `server-application-purity`, `server-ports-purity`,
`v1-route-delegation`). They are errors from day one rather than ratcheted
warnings, which is affordable **only because `server/` is new**: there is no
pre-existing violation to grandfather. The cheapest moment to enforce a boundary
is before anything has crossed it.

This repo has direct evidence that documentation alone does not hold a line: the
SuperAdmin UI's first draft bypassed `components/ui/*` despite a design-system
document saying not to (see `docs/design/carrieros-design-system.md` §11).

### Dependency injection by constructor

Services take their dependencies explicitly (`new EntitlementService({repository,
clock, logger})`). No module-scope database client, no service locator. A global
client is what makes tenant scoping invisible and tests require a live database.

### Clock and IdGenerator are ports

Entitlement rules compare against `now` constantly (trial expiry, grace
periods); tracking health is defined by elapsed time. A rule that reads the
system clock cannot be tested without sleeping or freezing global time. Passing
`now` in is why all 24 entitlement tests run in 5ms with no database.

## Consequences

**Positive.** Domain rules are unit-testable with plain objects. Authorization
becomes layered (application policy *and* RLS). Persistence is swappable. The
API can move to its own service without redesign.

**Negative.** More files and one more indirection for simple reads. Two idioms
coexist during migration — legacy `lib/` + route handlers alongside
`server/` + `/api/v1` — which is the price of not doing a big-bang rewrite. The
remaining-direct-access inventory tracks the debt so the second idiom does not
become permanent.

**Cost accepted.** `UnitOfWork` cannot be implemented over PostgREST, which
cannot span statements in one transaction. The adapter must route multi-write
commands through a SQL function. That is SQL in *infrastructure*, which the
constraints allow — not business logic in the database.
