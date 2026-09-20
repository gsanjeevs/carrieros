# ADR 0003 — All frontend data access goes through one shared API

**Date:** 2026-09-20
**Status:** Accepted (foundation + loads pilot implemented; migration in progress)
**Builds on:** ADR 0002 (layered server architecture). ADR 0002 created the
`app/api/v1 -> server/application -> ports -> infrastructure` stack; this ADR
makes it the *only* way UI code touches data, and adds live updates.

## Decision

1. **No direct database, RPC or storage calls from UI code** — mobile screens,
   web client components, and web Server Components alike. Reads and writes go
   through application services.
2. **One implementation, two doors.** Each use case lives once, in
   `server/application`. Mobile and web client code reach it over HTTP
   (`/api/v1/*`); web Server Components call the *same service in-process*
   (`server/composition.ts`) rather than making an HTTP request to themselves.
   No per-app copy of any rule.
3. **Schema-first contract.** Request/response shapes are zod schemas in
   `server/contract/`. `npm run gen:api` (in `carrieros-web`) builds an OpenAPI
   document, TypeScript types, and a typed client runtime, and writes identical
   files into both apps (`lib/generated/` and `src/lib/generated/`). CI runs
   `npm run check:api`, so a client left behind fails the build. Same generator
   pattern as `regen-types.sh` and `gen-role-capabilities.mjs`.
4. **Live updates via an API-owned SSE stream**, `GET /api/v1/events`.
   * DB triggers (migration 0012) write **signal-only** rows to `change_events`
     (`org_id`, `entity`, `op` — never business data).
   * The stream polls that table by cursor (2 s), emits `event: change` with just
     `{entity}`, honours `Last-Event-ID`, sends keepalives, and closes after
     ~270 s; the client reconnects, resumes from the last id, and emits a
     synthetic `resync` so the UI refetches after any gap.
   * A signal says only "loads changed"; the client **refetches through the API**,
     which applies role and tenant rules as for any read. That is why live
     updates are not a second, unfiltered data path (a driver cannot learn a rate
     or another driver's load from the stream — it never carries them).
   * Web: `<LiveRefresh entities={['loads']}/>` -> `router.refresh()`. Mobile:
     `useLiveRefresh(apiClient, ['loads'], reload)`.
5. **Enforcement is a ratchet** in `scripts/check-architecture.mjs`
   (`api-only-frontend`): legacy direct call sites are counted and reported as
   debt; a migrated file is added to `API_ONLY` and any new direct call in it is
   a hard error.
6. **RLS stays** as defence in depth: API code uses the caller's own scoped
   Supabase client, and repositories additionally scope by `actor.orgId`.
   `supabase.auth` (sign-in, refresh) remains a direct client call by necessity.

## Chosen, and what it costs

* *Lint + RLS backstop, not a hard lockdown.* A determined user can still call
  PostgREST with their own token and reach only their own tenant's rows. Revoking
  `authenticated` table grants would close that but forces the API onto
  `service_role` with hand-written tenant filters, trading RLS's safety net for
  many chances to leak. Revisit once the migration is complete.
* *Polling SSE.* Works on serverless, containers and laptops with no extra
  infrastructure and is trivially testable. Costs: each open stream is one indexed
  query per 2 s per subscriber; a serverless host bills the open connection for
  up to `maxDuration`; React Native needs `expo/fetch` to stream. If subscriber
  counts grow, move the wake-up to Postgres `LISTEN/NOTIFY` on a long-lived Node
  service (the cursor/`Last-Event-ID` contract does not change).
* *More files per use case* (port, adapter, service, schema, route) than the old
  inline `.from()` call. That indirection is the price of one rule set.

## Implemented so far (pilot: loads list)

| Piece | Where |
|---|---|
| Contract | `server/contract/{schemas,endpoints,openapi}.ts`, `openapi.json` |
| Generated client (both apps) | `lib/generated/`, `carrieros-mobile/src/lib/generated/` |
| Use case | `server/application/load-query-service.ts` (+ `identity-service`, `change-feed-service`) |
| Ports / adapters | `server/ports`, `server/infrastructure/supabase/*`, `server/composition.ts` |
| Endpoints | `GET /api/v1/{loads,me,events}` |
| Migrated screens | web `app/(app)/loads/page.tsx`, mobile `(tabs)/loads.tsx` |
| Writes migrated (batch 1) | `POST /api/v1/loads/{id}/milestones` (atomic status+timeline+audit+outbox, idempotent, CAS), `PATCH /api/v1/me/preferences`, `PUT /api/v1/me/push-token`; mobile offline queue is now a typed command queue over the same endpoint |
| Tests | `v1-loads`, `v1-events`, `api-client` (Vitest), CI drift check |

The pilot also fixed a real inconsistency: mobile enforced "drivers never see
`rate`" via a database view while web queried the base table and only hid the
column in the UI. Now one service omits the field from the payload for any role
without the `invoice_actions` capability.

## Migration roadmap

Remaining debt is printed by `check-architecture.mjs` on every run and itemised
in `architecture/inventory/*`. Suggested order (highest risk first):

1. **Writes** — (batch 1 done: load status, preferences, push token = 7 of 26 mobile writes) 26 mobile table writes, ~19 web client components that write
   directly. Each becomes a command endpoint; multi-step ones (load status +
   timeline) route through `submit_shipment_milestone` (0006–0011), which is
   already built but not yet called.
2. **Storage** — 7 mobile + web upload/download sites behind a signed-URL API.
3. **RPCs** — 8 mobile (`get_exceptions`, entitlements, IFTA, health score...).
4. **Reads** — 62 mobile + ~100 web, by screen, starting with dashboards.
5. Add each migrated file to `API_ONLY`; when the debt count is zero, tighten the
   check to fail on *any* direct call and reconsider the hard lockdown above.
