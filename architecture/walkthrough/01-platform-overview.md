# Platform overview

## What this is

CarrierOS is a TMS (transportation management system) for small trucking
carriers — dispatch, invoicing, driver messaging, DVIR, IFTA mileage
tracking, and a ShipmentX-internal SuperAdmin console for managing carrier
accounts. It hasn't shipped yet (staging-only as of this writing); the
architecture is being built for real scale (hundreds of carriers, thousands
of users, with a large share of usage from truck drivers on unreliable rural
connectivity) rather than as a thin MVP.

## The three pieces, one database

```
carrieros-web/      Next.js 16 (App Router), React 19, TypeScript
carrieros-mobile/    Expo/React Native (SDK 57), Expo Router
supabase/            Postgres + Auth, shared by both apps
```

- **`carrieros-web`** — the carrier-facing app (dispatch, invoicing,
  settings) and the ShipmentX-internal `/admin` SuperAdmin console, in one
  Next.js app. Read `carrieros-web/AGENTS.md` before making changes — Next.js
  16 has breaking API changes from most training data / prior habits.
- **`carrieros-mobile`** — the driver/dispatcher app. Read
  `carrieros-mobile/AGENTS.md` first for the same reason (Expo SDK 57).
- **`supabase/`** — one Postgres database, one schema, shared by both apps.
  Schema changes only ever go through `supabase/migrations/*.sql` — see
  [05-database-and-migrations.md](./05-database-and-migrations.md).

Both apps also have a **public, external-facing** integration surface — see
[03-api-and-public-api.md](./03-api-and-public-api.md) — and the
`carrieros-mcp` project (a separate repo) is a real third-party-style
consumer of it, worth pointing to as a concrete "what does an external
integration look like" example.

## The layered server architecture, in one picture

```
app/api/v1/**           transport    parse, authenticate, authorize, validate,
                                      delegate, map result → HTTP
server/application/     use cases    orchestration; depends on domain + ports
server/domain/          model        entities, value objects, state machines; PURE
server/ports/           interfaces   repositories, clock, ids, outbox, storage
server/infrastructure/  adapters     Supabase/Postgres implementations
```

Dependencies point inward only — `domain` imports nothing but `domain`.
Full rationale: `architecture/adr/0002-layered-server-architecture.md`.
Deep dive with real code: [02-domain-application-layer.md](./02-domain-application-layer.md).

This is a live migration, not a finished state: a legacy surface of
route handlers/components that call Supabase directly still exists alongside
it. `architecture/inventory/remaining-direct-access.json` tracks the
remaining debt.

## Hard rules the team enforces mechanically, not by convention

These are checked by a git hook, CI check, or generator — a violation should
fail fast, not merge silently. (Source: root `CLAUDE.md`, "Architectural
rules" section — read that file directly for the full list and rationale;
summarized here for orientation.)

1. **API-only data access (ADR 0003)** — UI code never calls
   `.from()`/`.rpc()`/`.storage` directly; it goes through `/api/v1` (mobile:
   `apiClient`) or in-process `server/composition.ts` (web pages). Enforced
   by `check-architecture.mjs`'s `API_ONLY` list.
2. **Migrations are immutable once applied** — fix forward with a new
   migration, never edit a committed one. Enforced in
   `scripts/git-hooks/pre-commit`.
3. **`supabase/schema/schema.sql` must match the migrations** — hand-updated
   alongside every migration; `verify-migrations.mjs` catches drift but does
   not generate the file for you.
4. **No raw Tailwind card/badge styling outside `components/ui/*`** —
   flagged by an ESLint rule, `warn` repo-wide, `error` on fully-migrated
   surfaces.
5. **Hot tables (`profiles`/`loads`/`drivers`) go through `lib/queries/*.ts`**,
   not ad hoc `.from()` calls.
6. **Role→capability logic has one source of truth**: generated
   `ROLE_CAPABILITIES`/`roleHasCapability()` from the `role_capabilities`
   Postgres table, consumed identically by both apps. See
   [04-auth-and-authorization.md](./04-auth-and-authorization.md).
7. **Design tokens have one source of truth**: `carrieros-web/app/globals.css`'s
   `@theme` block mirrors into `carrieros-mobile/src/constants/theme.ts`;
   `check-tokens.mjs` fails the build on drift.

## Demo accounts (persistent — not deleted between sessions)

Useful for following along live or for manual QA:

| Account | Password | Role |
|---|---|---|
| `demo@carrieros.dev` | `Demo123!` | Owner, "Sierra Freight Co" (carrier tenant, org 12) — trucks T-1/T-2, driver D-1 Mike Rodriguez, loads L-1/L-2/L-3 |
| `mike.driver@carrieros.dev` | `Demo123!` | Driver on the same org |
| `info@shipmentx.com` | `Demo123!` | `sx_owner` — ShipmentX's own internal `type='platform'` org, for testing `/admin` SuperAdmin |

`./scripts/reset-demo.sh` resets these 3 accounts' language/unit/date prefs
and Sierra Freight Co's trial clock without touching anything else — run it
after browser-testing changes any of that.

For SuperAdmin screens (`/admin/triage`, `/admin/health`, `/admin/pipeline`,
`/admin/billing`) that need multiple orgs in different states,
`carrieros-web/scripts/load-demo-data.mjs [--reset]` seeds 4 additional
carrier orgs (trialing, past-due-with-grace-period, starter-tier,
healthy-growth-tier) — idempotent, reruns are a no-op for orgs that already
have data. See that script's own comments and root `CLAUDE.md`'s "Demo data
for the ShipmentX admin console" section for the full breakdown.

## Where things are NOT yet built

- **Production** doesn't exist — staging only. See
  [07-deployment-and-environments.md](./07-deployment-and-environments.md).
- **Mobile isn't pointed at staging** — `EXPO_PUBLIC_API_URL` is still local
  dev. See [06-mobile-app.md](./06-mobile-app.md).
- **Auto-deploy on push** isn't wired — staging deploys are a manual,
  documented set of commands today.
